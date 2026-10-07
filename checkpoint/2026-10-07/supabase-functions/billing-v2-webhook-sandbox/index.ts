import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const URL=Deno.env.get("SUPABASE_URL")||"", KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const a=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json"}});
const prices:any={axiva:45,axiva_plus:79.8,axiva_max:164.8};
// CORRECAO: user_plan_assignments nao tem coluna id (chave = organization_id + user_id). Usa upsert e verifica erro.
async function legacy(org:string,user:string,plan:string,status:string){
 const now=new Date().toISOString();
 const r=await a.from("user_plan_assignments").upsert({organization_id:org,user_id:user,plan_id:plan,status,trial_started_at:null,trial_ends_at:null,assigned_by:user,assigned_at:now,updated_at:now},{onConflict:"organization_id,user_id"});
 if(r.error)throw new Error("PLAN_ASSIGNMENT_FAILED:"+r.error.message);
}
// CORRECAO: localiza o pedido pela referencia externa OU pelo id do checkout (eventos de assinatura e pagamento nao trazem a referencia).
async function findOrder(ref:string,checkoutId:string){
 if(ref.startsWith("axiva-billing-v2:")){
  const {data}=await a.from("axiva_billing_v2_orders").select("*").eq("external_reference",ref).maybeSingle();
  if(data)return data;
 }
 if(checkoutId){
  const {data}=await a.from("axiva_billing_v2_orders").select("*").eq("asaas_checkout_id",checkoutId).maybeSingle();
  if(data)return data;
 }
 return null;
}
async function provision(o:any,p:any){
 let uid=o.user_id;
 if(!uid&&o.target_email){
  const {data:list}=await a.auth.admin.listUsers({page:1,perPage:1000});
  const f=(list?.users||[]).find((u:any)=>String(u.email||"").toLowerCase()===String(o.target_email).toLowerCase());
  if(f)uid=f.id;else{const c=await a.auth.admin.createUser({email:o.target_email,email_confirm:true,user_metadata:{full_name:o.target_name||""}});if(c.error||!c.data?.user)throw new Error("USER_CREATE_FAILED");uid=c.data.user.id;}
 }
 if(!uid)throw new Error("USER_TARGET_MISSING");
 const sid=String(p?.subscription?.id||p?.payment?.subscription||o.asaas_subscription_id||"")||null;
 const cid=String(p?.customer?.id||p?.payment?.customer||p?.subscription?.customer||o.asaas_customer_id||"")||null;
 await a.from("axiva_billing_v2_licenses").update({user_id:uid,status:"active",asaas_customer_id:cid,asaas_subscription_id:sid,updated_at:new Date().toISOString()}).eq("id",o.license_id);
 await a.from("organization_members").upsert({organization_id:o.organization_id,user_id:uid,role:o.target_role||"user",is_active:true,deleted_at:null,display_name:(o.target_name||o.target_email||"Usuário").slice(0,80)},{onConflict:"organization_id,user_id"});
 await legacy(o.organization_id,uid,o.plan_id,"active");
 await a.from("axiva_billing_v2_contracts").update({user_id:uid,status:"paid",asaas_customer_id:cid,asaas_subscription_id:sid,updated_at:new Date().toISOString()}).eq("id",o.contract_id);
 await a.from("axiva_billing_v2_orders").update({status:"paid",user_id:uid,asaas_customer_id:cid,asaas_subscription_id:sid,paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",o.id);
 await a.from("axiva_billing_v2_accounts").upsert({organization_id:o.organization_id,environment:"sandbox",status:"active",default_plan_id:o.plan_id,updated_at:new Date().toISOString()},{onConflict:"organization_id"});
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const {data:cfg}=await a.from("axiva_asaas_config").select("sandbox_webhook_token").eq("id",1).maybeSingle();
 if(!cfg?.sandbox_webhook_token||req.headers.get("asaas-access-token")!==cfg.sandbox_webhook_token)return json({error:"Unauthorized"},401);
 let p:any;try{p=await req.json()}catch{return json({error:"Invalid JSON"},400)};
 const eid=String(p?.id||""), et=String(p?.event||"");if(!eid||!et)return json({ok:true});
 const ins=await a.from("axiva_billing_v2_events").insert({environment:"sandbox",event_id:eid,event_type:et,payload:p});
 if(ins.error&&String(ins.error.message||"").toLowerCase().includes("duplicate"))return json({ok:true,duplicate:true});
 if(ins.error)return json({error:"Event storage failed"},500);
 try{
  const ref=String(p?.checkout?.externalReference||p?.subscription?.externalReference||p?.payment?.externalReference||"");
  const chk=String(p?.checkout?.id||p?.subscription?.checkoutSession||p?.payment?.checkoutSession||"");
  if(["CHECKOUT_CANCELED","CHECKOUT_EXPIRED"].includes(et)){
   const o=await findOrder(ref,chk);
   if(o){
     await a.from("axiva_billing_v2_orders").update({status:et==="CHECKOUT_CANCELED"?"cancelled":"expired",updated_at:new Date().toISOString()}).eq("id",o.id);
     await a.from("axiva_billing_v2_contracts").update({status:et==="CHECKOUT_CANCELED"?"cancelled":"expired",updated_at:new Date().toISOString()}).eq("id",o.contract_id);
     if(o.license_id) await a.from("axiva_billing_v2_licenses").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",o.license_id).eq("status","pending");
   }
  }
  // REGRA DE NEGOCIO: o acesso so e liberado quando o PAGAMENTO e confirmado pelo Asaas.
  // CHECKOUT_PAID (checkout concluido) apenas fica registrado e NAO libera plano nem licenca.
  if(["PAYMENT_CONFIRMED","PAYMENT_RECEIVED"].includes(et)&&["CONFIRMED","RECEIVED","RECEIVED_IN_CASH"].includes(String(p?.payment?.status||""))){
   const o=await findOrder(ref,chk);
   if(o&&o.status!=="paid")await provision(o,p);
  }
  if(["SUBSCRIPTION_CREATED","SUBSCRIPTION_UPDATED"].includes(et)){
   const o=await findOrder(ref,chk);
   if(o){const sid=String(p?.subscription?.id||"")||null,cid=String(p?.subscription?.customer||"")||null;await a.from("axiva_billing_v2_orders").update({asaas_subscription_id:sid,asaas_customer_id:cid,updated_at:new Date().toISOString()}).eq("id",o.id);if(o.license_id)await a.from("axiva_billing_v2_licenses").update({asaas_subscription_id:sid,asaas_customer_id:cid,updated_at:new Date().toISOString()}).eq("id",o.license_id);}
  }
  if(["SUBSCRIPTION_INACTIVATED","SUBSCRIPTION_DELETED"].includes(et)){
   const sid=String(p?.subscription?.id||"");const {data:l}=await a.from("axiva_billing_v2_licenses").select("organization_id,user_id,plan_id").eq("asaas_subscription_id",sid).maybeSingle();
   if(l?.user_id){await a.from("axiva_billing_v2_licenses").update({status:"suspended",updated_at:new Date().toISOString()}).eq("asaas_subscription_id",sid);await legacy(l.organization_id,l.user_id,l.plan_id,"suspended");}
  }
  if(et==="PAYMENT_OVERDUE"){
   const sid=String(p?.payment?.subscription||"");const {data:l}=await a.from("axiva_billing_v2_licenses").select("organization_id,user_id,plan_id").eq("asaas_subscription_id",sid).maybeSingle();
   if(l?.user_id){await a.from("axiva_billing_v2_licenses").update({status:"past_due",updated_at:new Date().toISOString()}).eq("asaas_subscription_id",sid);await legacy(l.organization_id,l.user_id,l.plan_id,"suspended");}
  }
  await a.from("axiva_billing_v2_events").update({processed_at:new Date().toISOString()}).eq("environment","sandbox").eq("event_id",eid);
  return json({ok:true});
 }catch(e){
  // Nao devolve 500: um erro aqui travaria a fila sequencial do Asaas. O evento fica salvo com processed_at vazio para reprocessamento.
  console.error("billing-v2-webhook-sandbox error",et,eid,String(e?.message||e).slice(0,250));
  return json({ok:true,processed:false,error:String(e?.message||e).slice(0,250)});
 }
});
