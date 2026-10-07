import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ENV = "sandbox";
const ASAAS_BASE = "https://api-sandbox.asaas.com/v3";
const ASAAS_KEY = () => Deno.env.get("ASAAS_SANDBOX_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json","Cache-Control":"no-store"};

const admin=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:CORS});
// CORRECAO: data de hoje no horario de Brasilia (o primeiro vencimento volta a ser o dia da contratacao, como na cobranca V1).
function brazilDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
const plans:any={axiva:{name:"AXIVA",value:45},axiva_plus:{name:"AXIVA Plus",value:79.8},axiva_max:{name:"AXIVA Max",value:164.8}};

async function api(path:string,init:RequestInit={}) {
  const key=ASAAS_KEY(); if(!key) throw new Error("ASAAS_NOT_CONFIGURED");
  const r=await fetch(ASAAS_BASE+path,{...init,headers:{access_token:key,Accept:"application/json","Content-Type":"application/json",...(init.headers||{})}});
  const raw=await r.text(); let data:any={}; try{data=raw?JSON.parse(raw):{}}catch{}
  if(!r.ok){ console.error("billing-v2 Asaas API error", JSON.stringify({path,status:r.status,response:data?.errors||data})); throw new Error("ASAAS_HTTP_"+r.status+":"+JSON.stringify(data?.errors||data).slice(0,500)); }
  return data;
}
async function auth(req:Request){
  const h=req.headers.get("Authorization")||""; if(!h.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const {data,error}=await admin.auth.getUser(h.slice(7)); if(error||!data?.user) throw new Error("UNAUTHORIZED");
  return data.user;
}
async function orgFor(userId:string,requestedOrgId:string=""){
  if(requestedOrgId){
    const {data:adminRow}=await admin.from("system_admins").select("user_id").eq("user_id",userId).maybeSingle();
    if(adminRow?.user_id){
      const {data:org}=await admin.from("organizations").select("id,name,cnpj,is_sandbox,is_active,deleted_at").eq("id",requestedOrgId).maybeSingle();
      if(org?.is_sandbox===true && org.is_active && !org.deleted_at) return {organization_id:org.id,role:"owner",is_test_admin:true};
    }
  }
  const {data,error}=await admin.from("organization_members").select("organization_id,role").eq("user_id",userId).eq("is_active",true).is("deleted_at",null).order("created_at",{ascending:true}).limit(1).maybeSingle();
  if(error||!data) throw new Error("ORGANIZATION_NOT_FOUND"); return data;
}
async function isAdmin(userId:string,orgId:string){
  const {data}=await admin.from("organization_members").select("role").eq("organization_id",orgId).eq("user_id",userId).eq("is_active",true).is("deleted_at",null).maybeSingle();
  return ["owner","admin"].includes(String(data?.role||""));
}
// CORRECAO: user_plan_assignments nao tem coluna id (chave = organization_id + user_id). Usa upsert e verifica erro.
async function syncLegacy(orgId:string,userId:string,planId:string,status:string,trialEnd:string|null=null){
  const now=new Date().toISOString();
  const legacyStatus=status==="active"?"active":status==="suspended"?"suspended":status;
  const r=await admin.from("user_plan_assignments").upsert({organization_id:orgId,user_id:userId,plan_id:planId,status:legacyStatus,trial_started_at:null,trial_ends_at:trialEnd,assigned_by:userId,assigned_at:now,updated_at:now},{onConflict:"organization_id,user_id"});
  if(r.error) throw new Error("PLAN_ASSIGNMENT_FAILED:"+r.error.message);
}
async function sendInvite(userId:string,email:string,name:string){
  const link=await admin.auth.admin.generateLink({type:"recovery",email,options:{redirectTo:"https://crm.axiva.com.br/?invite=1",data:{full_name:name}}});
  if(link.error||!link.data?.properties?.action_link) return false;
  const key=Deno.env.get("RESEND_API_KEY")||""; if(!key) return false;
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({
    from:"AXIVA CRM <no-reply@auth.axiva.com.br>",to:[email],subject:"Seu acesso ao AXIVA CRM foi liberado",
    html:"<div style='font-family:Arial,sans-serif;color:#0B192C;max-width:560px;margin:40px auto'><h2>Seu acesso ao AXIVA CRM foi liberado</h2><p>Olá, "+name.replace(/[<>]/g,"")+"!</p><p>O pagamento da licença foi confirmado. Defina sua senha pelo botão abaixo:</p><p><a href='"+link.data.properties.action_link+"' style='display:inline-block;padding:12px 20px;background:#00A88F;color:#fff;text-decoration:none;border-radius:8px'>Definir senha e acessar</a></p></div>"
  })});
  return r.ok;
}
async function provision(order:any,event:any){
  let userId=order.user_id as string|null;
  if(!userId && order.target_email){
    const {data:list}=await admin.auth.admin.listUsers({page:1,perPage:1000});
    const found=(list?.users||[]).find((u:any)=>String(u.email||"").toLowerCase()===String(order.target_email).toLowerCase());
    if(found) userId=found.id;
    else {
      const created=await admin.auth.admin.createUser({email:order.target_email,email_confirm:true,user_metadata:{full_name:order.target_name||""}});
      if(created.error||!created.data?.user) throw new Error("USER_CREATE_FAILED");
      userId=created.data.user.id;
    }
  }
  if(!userId) throw new Error("USER_TARGET_MISSING");
  const lic=await admin.from("axiva_billing_v2_licenses").select("*").eq("id",order.license_id).maybeSingle();
  if(lic.error||!lic.data) throw new Error("LICENSE_NOT_FOUND");
  const subId=String(event?.subscription?.id||event?.payment?.subscription||event?.subscriptionId||order.asaas_subscription_id||"")||null;
  const customerId=String(event?.customer?.id||event?.payment?.customer||event?.subscription?.customer||order.asaas_customer_id||"")||null;
  await admin.from("axiva_billing_v2_licenses").update({user_id:userId,status:"active",asaas_customer_id:customerId,asaas_subscription_id:subId,updated_at:new Date().toISOString()}).eq("id",lic.data.id);
  await admin.from("organization_members").upsert({organization_id:order.organization_id,user_id:userId,role:order.target_role||"user",is_active:true,display_name:(order.target_name||order.target_email||"Usuário").slice(0,80),deleted_at:null},{onConflict:"organization_id,user_id"});
  await syncLegacy(order.organization_id,userId,order.plan_id,"active",null);
  await admin.from("axiva_billing_v2_contracts").update({user_id:userId,status:"paid",asaas_customer_id:customerId,asaas_subscription_id:subId,updated_at:new Date().toISOString()}).eq("id",order.contract_id);
  await admin.from("axiva_billing_v2_orders").update({status:"paid",user_id:userId,asaas_customer_id:customerId,asaas_subscription_id:subId,paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",order.id);
  await admin.from("axiva_billing_v2_accounts").upsert({organization_id:order.organization_id,environment:ENV,status:"active",default_plan_id:order.plan_id,updated_at:new Date().toISOString()},{onConflict:"organization_id"});
  if(order.target_email && order.order_type==="add_license") await sendInvite(userId,order.target_email,order.target_name||"Usuário");
}
async function acceptContract(user:any,body:any){
  const planId=String(body?.planId||""); if(!plans[planId]) return json({error:"Plano inválido."},400);
  const m=await orgFor(user.id,String(body?.organizationId||"")); const adminRole=m.is_test_admin===true?true:await isAdmin(user.id,m.organization_id);
  const mode=String(body?.mode||"first_access");
  if(mode==="add_license"&&!adminRole) return json({error:"Somente o proprietário ou administrador pode adicionar usuários."},403);
  const targetEmail=String(body?.targetEmail||user.email||"").trim().toLowerCase();
  const targetName=String(body?.targetName||user.user_metadata?.full_name||"").trim();
  if(!targetEmail||!targetName) return json({error:"Nome e e-mail são obrigatórios."},400);
  if(mode==="add_license"){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) return json({error:"Informe um e-mail válido."},400);
    const {data:existing}=await admin.auth.admin.listUsers({page:1,perPage:1000});
    const existingUser=(existing?.users||[]).find((u:any)=>String(u.email||"").toLowerCase()===targetEmail);
    if(existingUser){
      const {data:mem}=await admin.from("organization_members").select("user_id").eq("organization_id",m.organization_id).eq("user_id",existingUser.id).eq("is_active",true).is("deleted_at",null).maybeSingle();
      if(mem) return json({error:"Este usuário já pertence à empresa."},409);
    }
  }
  const {data:org}=await admin.from("organizations").select("id,name,cnpj").eq("id",m.organization_id).maybeSingle();
  if(!org) return json({error:"Organização não encontrada."},404);
  const contract=await admin.from("axiva_billing_v2_contracts").insert({
    organization_id:m.organization_id,user_id:mode==="add_license"?null:user.id,plan_id:planId,license_quantity:1,
    contract_version:String(body?.contractVersion||"2026-10-06-v1"),status:"pending_payment",accepted_at:new Date().toISOString(),
    signer_name:targetName,signer_email:targetEmail,cnpj:org.cnpj||null
  }).select("id").single();
  if(contract.error){ console.error("billing-v2 contract insert failed", JSON.stringify({message:contract.error.message,details:contract.error.details,hint:contract.error.hint,code:contract.error.code})); return json({error:"Não foi possível registrar o aceite do contrato.",details:contract.error.message},500); }
  let licenseId:string;
  if(mode==="add_license"){
    const license=await admin.from("axiva_billing_v2_licenses").insert({
      organization_id:m.organization_id,user_id:null,plan_id:planId,status:"pending",created_by:user.id
    }).select("id").single();
    if(license.error) return json({error:"Não foi possível preparar a licença."},500);
    licenseId=license.data.id;
  }else{
    const existing=await admin.from("axiva_billing_v2_licenses").select("id,status").eq("organization_id",m.organization_id).eq("user_id",user.id).maybeSingle();
    if(existing.data){
      const up=await admin.from("axiva_billing_v2_licenses").update({plan_id:planId,status:"pending",updated_at:new Date().toISOString()}).eq("id",existing.data.id).select("id").single();
      if(up.error) return json({error:"Não foi possível preparar a licença."},500);
      licenseId=up.data.id;
    }else{
      const license=await admin.from("axiva_billing_v2_licenses").insert({
        organization_id:m.organization_id,user_id:user.id,plan_id:planId,status:"pending",created_by:user.id
      }).select("id").single();
      if(license.error) return json({error:"Não foi possível preparar a licença."},500);
      licenseId=license.data.id;
    }
  }
  await admin.from("axiva_billing_v2_contracts").update({license_id:licenseId}).eq("id",contract.data.id);
  return json({ok:true,contractId:contract.data.id,licenseId,mode});
}
async function createCheckout(user:any,body:any){
  const contractId=String(body?.contractId||""); if(!contractId) return json({error:"Contrato não informado."},400);
  const {data:c}=await admin.from("axiva_billing_v2_contracts").select("*").eq("id",contractId).maybeSingle();
  if(!c) return json({error:"Contrato não encontrado."},404);
  const m=await orgFor(user.id,String(body?.organizationId||""));
  if(c.organization_id!==m.organization_id){
    const {data:platform}=await admin.from("system_admins").select("user_id").eq("user_id",user.id).maybeSingle();
    const {data:testOrg}=await admin.from("organizations").select("id,is_sandbox,is_active,deleted_at").eq("id",c.organization_id).maybeSingle();
    if(!platform?.user_id||testOrg?.is_sandbox!==true||!testOrg.is_active||testOrg.deleted_at) return json({error:"Contrato não pertence à sua organização."},403);
  }
  if(c.user_id!==user.id && !["owner","admin"].includes(String(m.role))) return json({error:"Sem permissão para este contrato."},403);
  if(c.status!=="pending_payment") return json({error:"Este contrato não está aguardando pagamento."},409);
  const plan=plans[c.plan_id]; if(!plan) return json({error:"Plano inválido."},400);
  // Garante que o Webhook Sandbox esteja ativo e com os eventos de cobrança antes de criar o Checkout.
  const {data:webCfg}=await admin.from("axiva_asaas_config").select("sandbox_webhook_id,sandbox_webhook_token").eq("id",1).maybeSingle();
  if(webCfg?.sandbox_webhook_id && webCfg?.sandbox_webhook_token){
    try{
      const webhookUrl=SUPABASE_URL+"/functions/v1/billing-v2-webhook-sandbox";
      const webhookEvents=["CHECKOUT_CREATED","CHECKOUT_PAID","CHECKOUT_CANCELED","CHECKOUT_EXPIRED","SUBSCRIPTION_CREATED","SUBSCRIPTION_UPDATED","SUBSCRIPTION_INACTIVATED","SUBSCRIPTION_DELETED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_OVERDUE"];
      await api("/webhooks/"+encodeURIComponent(webCfg.sandbox_webhook_id),{method:"PUT",body:JSON.stringify({url:webhookUrl,enabled:true,interrupted:false,sendType:"SEQUENTIALLY",authToken:webCfg.sandbox_webhook_token,events:webhookEvents})});
    }catch(e){ console.error("billing-v2 webhook ensure failed",String(e?.message||e)); }
  }
  const orderRef="axiva-billing-v2:"+c.id;
  const existing=await admin.from("axiva_billing_v2_orders").select("*").eq("external_reference",orderRef).maybeSingle();
  if(existing.data?.asaas_checkout_link&&["pending","checkout_created"].includes(existing.data.status)) return json({ok:true,checkoutUrl:existing.data.asaas_checkout_link,checkoutId:existing.data.asaas_checkout_id,orderId:existing.data.id});
  const {data:order,error}=await admin.from("axiva_billing_v2_orders").insert({
    organization_id:c.organization_id,user_id:c.user_id,license_id:c.license_id,contract_id:c.id,
    order_type:c.user_id===user.id?"first_subscription":"add_license",plan_id:c.plan_id,amount:plan.value,environment:ENV,
    status:"pending",external_reference:orderRef,target_name:c.signer_name,target_email:c.signer_email,target_role:c.user_id===user.id?"owner":"user"
  }).select("*").single();
  if(error){ console.error("billing-v2 order insert failed", JSON.stringify({message:error.message,details:error.details,hint:error.hint,code:error.code})); return json({error:"Não foi possível criar o pedido de cobrança.",details:error.message},500); }
  try{
    const checkout=await api("/checkouts",{method:"POST",body:JSON.stringify({
      billingTypes:["CREDIT_CARD"],chargeTypes:["RECURRENT"],minutesToExpire:1440,externalReference:orderRef,
      callback:{successUrl:"https://crm.axiva.com.br/?billing=success",cancelUrl:"https://crm.axiva.com.br/?billing=cancelled",expiredUrl:"https://crm.axiva.com.br/?billing=expired"},
      items:[{name:"AXIVA CRM - "+plan.name,description:"Assinatura mensal do AXIVA CRM",quantity:1,value:plan.value}],
      subscription:{cycle:"MONTHLY",nextDueDate:brazilDate()}
    })});
    const checkoutId=String(checkout.id||""); const link=String(checkout.link||"");
    if(!checkoutId||!link) throw new Error("CHECKOUT_INVALID");
    await admin.from("axiva_billing_v2_orders").update({status:"checkout_created",asaas_checkout_id:checkoutId,asaas_checkout_link:link,updated_at:new Date().toISOString()}).eq("id",order.id);
    return json({ok:true,checkoutUrl:link,checkoutId,orderId:order.id});
  }catch(e){
    console.error("billing-v2 checkout failed", String(e?.message||e));
    await admin.from("axiva_billing_v2_orders").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",order.id);
    return json({error:"Não foi possível criar o checkout no Asaas.",details:String(e?.message||e).slice(0,250)},502);
  }
}
async function setupWebhook(user:any){
  const m=await orgFor(user.id);
  if(!["owner","admin"].includes(String(m.role))) return json({error:"Somente o proprietário ou administrador pode configurar o ambiente de cobrança."},403);
  const {data:cfg}=await admin.from("axiva_asaas_config").select("id,sandbox_webhook_id,sandbox_webhook_token").eq("id",1).maybeSingle();
  if(!cfg) return json({error:"Configuração do Asaas Sandbox não encontrada."},500);
  const webhookUrl=SUPABASE_URL+"/functions/v1/billing-v2-webhook-sandbox";
  const events=["CHECKOUT_CREATED","CHECKOUT_PAID","CHECKOUT_CANCELED","CHECKOUT_EXPIRED","SUBSCRIPTION_CREATED","SUBSCRIPTION_UPDATED","SUBSCRIPTION_INACTIVATED","SUBSCRIPTION_DELETED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_OVERDUE"];
  if(cfg.sandbox_webhook_id && cfg.sandbox_webhook_token){
    try{
      const current=await api("/webhooks/"+encodeURIComponent(cfg.sandbox_webhook_id));
      const currentEvents=(current?.events||[]).map((e:any)=>String(e?.event||e)).sort();
      const needsUpdate=String(current?.url||"")!==webhookUrl || current?.enabled!==true || current?.interrupted===true || JSON.stringify(currentEvents)!==JSON.stringify([...events].sort());
      if(needsUpdate) await api("/webhooks/"+encodeURIComponent(cfg.sandbox_webhook_id),{method:"PUT",body:JSON.stringify({url:webhookUrl,enabled:true,interrupted:false,sendType:"SEQUENTIALLY",authToken:cfg.sandbox_webhook_token,events})});
      return json({ok:true,configured:true,webhookId:cfg.sandbox_webhook_id,updated:needsUpdate});
    }catch(e){ console.error("billing-v2 webhook validation failed",String(e?.message||e)); }
  }
  const token=String(cfg.sandbox_webhook_token||"").trim() || crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
  const created=await api("/webhooks",{method:"POST",body:JSON.stringify({name:"AXIVA Billing V2 Sandbox",url:SUPABASE_URL+"/functions/v1/billing-v2-webhook-sandbox",email:"resposta@axiva.com.br",enabled:true,interrupted:false,apiVersion:3,authToken:token,sendType:"SEQUENTIALLY",events:["CHECKOUT_CREATED","CHECKOUT_PAID","CHECKOUT_CANCELED","CHECKOUT_EXPIRED","SUBSCRIPTION_CREATED","SUBSCRIPTION_UPDATED","SUBSCRIPTION_INACTIVATED","SUBSCRIPTION_DELETED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_OVERDUE"]})});
  const wid=String(created?.id||"");
  if(!wid) return json({error:"O Asaas não retornou o identificador do webhook."},502);
  await admin.from("axiva_asaas_config").update({sandbox_webhook_id:wid,sandbox_webhook_token:token,updated_at:new Date().toISOString()}).eq("id",1);
  return json({ok:true,configured:true,webhookId:wid});
}
async function manage(user:any,body:any){
  const m=await orgFor(user.id); if(!["owner","admin"].includes(String(m.role))) return json({error:"Somente o proprietário ou administrador pode alterar a cobrança."},403);
  const action=String(body?.action||"");
  if(action==="setup_webhook") return await setupWebhook(user);
  if(action==="status"){
    const {data:account}=await admin.from("axiva_billing_v2_accounts").select("*").eq("organization_id",m.organization_id).maybeSingle();
    const {data:licenses}=await admin.from("axiva_billing_v2_licenses").select("id,user_id,plan_id,status,asaas_subscription_id,next_due_date,pending_plan_id,pending_effective_date,pending_prorata_amount").eq("organization_id",m.organization_id);
    const {data:orders}=await admin.from("axiva_billing_v2_orders").select("id,order_type,plan_id,previous_plan_id,amount,prorata_amount,status,asaas_checkout_id,asaas_subscription_id,created_at,paid_at").eq("organization_id",m.organization_id).order("created_at",{ascending:false}).limit(20);
    return json({ok:true,account,licenses:licenses||[],orders:orders||[]});
  }
  if(action==="cancel"){
    const {data:ls}=await admin.from("axiva_billing_v2_licenses").select("id,user_id,plan_id,asaas_subscription_id").eq("organization_id",m.organization_id).eq("status","active");
    for(const l of (ls||[])){
      if(l.asaas_subscription_id){
        try{await api("/subscriptions/"+encodeURIComponent(l.asaas_subscription_id),{method:"DELETE"})}catch(e){return json({error:"Não foi possível cancelar uma das assinaturas no Asaas.",details:String(e?.message||e).slice(0,180)},502)}
      }
      await admin.from("axiva_billing_v2_licenses").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",l.id);
      if(l.user_id)await syncLegacy(m.organization_id,l.user_id,l.plan_id,"suspended",null);
    }
    await admin.from("axiva_billing_v2_accounts").update({status:"cancelled",cancelled_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("organization_id",m.organization_id);
    return json({ok:true});
  }
  if(action==="remove_license"){
    const target=String(body?.userId||""); if(!target||target===user.id) return json({error:"Não é possível remover sua própria licença."},400);
    const {data:l}=await admin.from("axiva_billing_v2_licenses").select("*").eq("organization_id",m.organization_id).eq("user_id",target).maybeSingle();
    if(!l) return json({error:"Licença não encontrada."},404);
    const {count}=await admin.from("axiva_billing_v2_licenses").select("id",{count:"exact",head:true}).eq("organization_id",m.organization_id).eq("status","active");
    if((count||0)<=1) return json({error:"A empresa precisa manter pelo menos uma licença ativa."},409);
    if(l.asaas_subscription_id){try{await api("/subscriptions/"+encodeURIComponent(l.asaas_subscription_id),{method:"DELETE"})}catch(e){return json({error:"Não foi possível cancelar a assinatura no Asaas.",details:String(e?.message||e).slice(0,180)},502)}}
    await admin.from("axiva_billing_v2_licenses").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",l.id);
    await syncLegacy(m.organization_id,target,l.plan_id,"suspended",null);
    await admin.from("organization_members").update({is_active:false,deleted_at:new Date().toISOString()}).eq("organization_id",m.organization_id).eq("user_id",target);
    return json({ok:true});
  }
  if(action==="change_plan"){
    const target=String(body?.userId||""); const newPlan=String(body?.planId||""); if(!plans[newPlan]) return json({error:"Plano inválido."},400);
    const {data:l}=await admin.from("axiva_billing_v2_licenses").select("*").eq("organization_id",m.organization_id).eq("user_id",target).eq("status","active").maybeSingle();
    if(!l) return json({error:"Licença ativa não encontrada."},404);
    if(l.plan_id===newPlan) return json({ok:true,unchanged:true});
    if(l.asaas_subscription_id){try{await api("/subscriptions/"+encodeURIComponent(l.asaas_subscription_id),{method:"DELETE"})}catch(e){return json({error:"Não foi possível cancelar a assinatura atual no Asaas."},502)}}
    const c=await admin.from("axiva_billing_v2_contracts").insert({organization_id:m.organization_id,user_id:target,license_id:l.id,plan_id:newPlan,license_quantity:1,contract_version:"2026-10-06-v1",status:"pending_payment",accepted_at:new Date().toISOString(),signer_name:"Alteração de plano",signer_email:user.email||"",cnpj:null}).select("id").single();
    if(c.error)return json({error:"Não foi possível iniciar a alteração de plano."},500);
    await admin.from("axiva_billing_v2_licenses").update({plan_id:newPlan,status:"pending",asaas_subscription_id:null,updated_at:new Date().toISOString()}).eq("id",l.id);
    return json({ok:true,contractId:c.data.id,requiresContract:true});
  }
  return json({error:"Ação inválida."},400);
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const user=await auth(req); const body=await req.json(); const action=String(body?.action||"");
    console.log("billing-v2 request", JSON.stringify({action,contractId:body?.contractId||null,planId:body?.planId||null,mode:body?.mode||null}));
    if(action==="accept_contract")return await acceptContract(user,body);
    if(action==="create_checkout")return await createCheckout(user,body);
    return await manage(user,body);
  }catch(e){
    const m=String((e as any)?.message||e);
    console.error("billing-v2 unhandled error", m);
    if(m==="UNAUTHORIZED")return json({error:"Sessão inválida."},401);
    if(m==="ORGANIZATION_NOT_FOUND")return json({error:"Organização não encontrada."},404);
    if(m==="ASAAS_NOT_CONFIGURED")return json({error:"A integração de cobrança não está configurada."},503);
    return json({error:"Não foi possível processar a cobrança.",details:m.slice(0,250)},500);
  }
});
