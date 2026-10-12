import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseSecretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const resendApiKey = Deno.env.get("RESEND_API_KEY")!
const admin = createClient(supabaseUrl, supabaseSecretKey, { auth: { autoRefreshToken:false, persistSession:false, detectSessionInUrl:false } })
const allowedOrigin = "https://crm-prospeccao-lks4ikxuy-claudiorogb-3509.vercel.app"
const ALLOWED_ORIGINS = new Set(["https://crm.axiva.com.br","https://crm-prospeccao-app.vercel.app",allowedOrigin])
const PREVIEW_ORIGIN = /^https:\/\/crm-prospeccao-[a-z0-9]+-claudiorogb-3509\.vercel\.app$/
function corsOriginFor(o:string){return (ALLOWED_ORIGINS.has(o)||PREVIEW_ORIGIN.test(o))?o:allowedOrigin}
const RECOVERY_EMAIL = "contato@axiva.com.br"
// CORRECAO: o link de confirmacao de e-mail leva para o site de producao (antes apontava para um preview antigo protegido pela Vercel).
const CONFIRM_REDIRECT = "https://crm.axiva.com.br/?confirmed=1"

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage","Access-Control-Allow-Methods":"POST, OPTIONS"}})}
function escapeHtml(v:string){return v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function normalizeCnpj(v:unknown){const d=String(v||"").replace(/\D/g,"");return d.length===14?d:""}
// Telefone com DDD, somente numeros (10 a 13 digitos). Invalido/ausente = null.
function normalizePhone(v:unknown){const d=String(v||"").replace(/\D/g,"");return d.length>=10&&d.length<=13?d:null}

async function sendConfirmation(email:string,fullName:string,actionLink:string,existing=false){
 const safe=escapeHtml(fullName||"cliente")
 const html=existing
 ? `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0B192C;line-height:1.5"><div style="max-width:560px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:14px"><h2>Confirme seu e-mail</h2><p>Olá, ${safe}.</p><p>Seu cadastro foi associado à organização existente pelo CNPJ informado.</p><p>O acesso será liberado somente após a aprovação do Administrador da empresa.</p><p><a href="${actionLink}" style="display:inline-block;padding:12px 20px;background:#00A88F;color:#fff;text-decoration:none;border-radius:8px">Confirmar e-mail</a></p></div></body></html>`
 : `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0B192C;line-height:1.5"><div style="max-width:560px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:14px"><h2>Confirme seu e-mail</h2><p>Olá, ${safe}.</p><p>Para continuar seu cadastro no AXIVA CRM, confirme seu endereço de e-mail.</p><p><a href="${actionLink}" style="display:inline-block;padding:12px 20px;background:#00A88F;color:#fff;text-decoration:none;border-radius:8px">Confirmar e-mail</a></p><p style="font-size:13px;color:#64748b">Se você não criou esta conta, ignore esta mensagem.</p></div></body></html>`
 const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${resendApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:"AXIVA CRM <no-reply@auth.axiva.com.br>",to:[email],subject:"Confirme seu e-mail — AXIVA CRM",html})})
 return rr.ok
}

async function handle(req:Request):Promise<Response>{
 if(req.method==="OPTIONS")return json({ok:true})
 if(req.method!=="POST")return json({error:"Método não permitido."},405)
 try{
  const body=await req.json()
  const email=String(body?.email||"").trim().toLowerCase()
  const password=String(body?.password||"")
  const fullName=String(body?.fullName||"").trim()
  const organizationName=String(body?.organizationName||"").trim()
  const cnpj=normalizeCnpj(body?.cnpj)
  const phone=normalizePhone(body?.phone)
  const requestedOnboardingType=String(body?.onboardingType||"").trim().toLowerCase()
  const onboardingType=requestedOnboardingType==="trial" ? "trial" : (requestedOnboardingType==="paid" || (organizationName && cnpj.length===14) ? "paid" : requestedOnboardingType)
  if(!email||!email.includes("@"))return json({error:"E-mail inválido."},400)
  if(password.length<10)return json({error:"A senha precisa ter pelo menos 10 caracteres."},400)
  if((onboardingType==="paid" || onboardingType==="trial") && (!organizationName||cnpj.length!==14))return json({error:"Nome da empresa e CNPJ são obrigatórios para a contratação."},400)

  // E-mail liberado pela Administração (Usuários excluídos › Reativar usuário, sem empresa):
  // pode fazer novo cadastro e contratar um plano, mas não tem mais direito ao Trial de 30 dias.
  if(onboardingType==="trial"){
   const blocked=await admin.from("axiva_trial_blocked_emails").select("email").eq("email",email).maybeSingle()
   if(blocked.error)throw blocked.error
   if(blocked.data)return json({error:"Este e-mail não tem mais direito ao período de testes de 30 dias. Escolha um plano para contratar o AXIVA CRM.",code:"EMAIL_TRIAL_NOT_AVAILABLE"},409)
  }

  let existingOrg:any=null
  if(onboardingType==="paid" || onboardingType==="trial"){
   const q=await admin.from("organizations").select("id,name,cnpj,is_active,deleted_at,trial_used_at").eq("cnpj",cnpj).limit(1).maybeSingle()
   if(q.error)throw q.error
   existingOrg=q.data
  }
  // SEGURANCA: toda conta (inclusive contratacao paga) so e liberada depois da confirmacao do e-mail.
  // Depois de confirmar e entrar, o CRM continua a contratacao do plano escolhido.

  const userMetadata={...(fullName?{full_name:fullName}:{}),...(onboardingType==="trial"?{organization_name:organizationName,cnpj}: {})}
  const created=await admin.auth.admin.createUser({email,password,user_metadata:userMetadata,email_confirm:false})
  if(created.error){
   if(/already registered|already exists/i.test(String(created.error.message||"")))return json({error:"Não foi possível concluir o cadastro com este e-mail."},400)
   throw created.error
  }
  const userId=created.data.user?.id
  if(!userId)throw new Error("Não foi possível criar a conta.")
  const linkResult=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:userMetadata,redirectTo:CONFIRM_REDIRECT}})
  if(linkResult.error)throw linkResult.error
  const data:any=linkResult.data

  const membership=await admin.from("organization_members").select("organization_id").eq("user_id",userId).eq("is_active",true).is("deleted_at",null).limit(1).maybeSingle()
  if(membership.error)throw membership.error
  if(membership.data)return json({error:"Esta conta já está vinculada a uma empresa."},400)

  if((onboardingType==="paid" || onboardingType==="trial") && existingOrg){
   if(existingOrg.deleted_at)return json({error:"Este CNPJ está associado a uma organização encerrada. Entre em contato com o administrador do sistema para recuperar o acesso.",recoveryEmail:RECOVERY_EMAIL,code:"CNPJ_ORGANIZATION_CLOSED"},409)
   const billing=await admin.from("axiva_billing_accounts").select("status").eq("organization_id",existingOrg.id).maybeSingle()
   if(billing.error)throw billing.error
   const admins=await admin.from("organization_members").select("user_id").eq("organization_id",existingOrg.id).eq("is_active",true).is("deleted_at",null).in("role",["owner","admin"]).limit(1).maybeSingle()
   if(admins.error)throw admins.error
   const hasAdmin=!!admins.data
   const paidActive=["active","past_due"].includes(String(billing.data?.status||"").toLowerCase())
   if(existingOrg.trial_used_at && !paidActive)return json({error:"Esse CNPJ já utilizou o período de testes. Caso não tenha sido você, entre em contato com o administrador do sistema para recuperar sua conta.",recoveryEmail:RECOVERY_EMAIL,code:"CNPJ_TRIAL_ALREADY_USED"},409)
   if(!hasAdmin)return json({error:"Este CNPJ já está cadastrado, mas não possui um Administrador ativo. Entre em contato com o administrador do sistema para recuperar o acesso.",recoveryEmail:RECOVERY_EMAIL,code:"CNPJ_WITHOUT_ACTIVE_ADMIN"},409)
   const reqRow=await admin.from("organization_access_requests").upsert({organization_id:existingOrg.id,user_id:userId,requested_name:fullName||email,requested_email:email,requested_role:"member",status:"pending",updated_at:new Date().toISOString()},{onConflict:"organization_id,user_id"})
   if(reqRow.error)throw reqRow.error
   const actionLink=data?.properties?.action_link
   if(!actionLink)throw new Error("Não foi possível gerar o link de confirmação.")
   if(!(await sendConfirmation(email,fullName,actionLink,true)))return json({error:"O cadastro foi registrado, mas não foi possível enviar o e-mail de confirmação."},502)
   return json({ok:true,userId,status:"pending_organization_approval",organizationId:existingOrg.id,organizationName:existingOrg.name,message:"Cadastro realizado. Confirme seu e-mail. O acesso será liberado após a aprovação do Administrador da empresa."})
  }
  if(onboardingType==="paid" || onboardingType==="trial"){
   const org=await admin.from("organizations").insert({name:organizationName.slice(0,160),created_by:userId,cnpj,phone,trial_used_at:onboardingType==="trial"?new Date().toISOString():null}).select("id").single()
   if(org.error){
    if(String(org.error.code)==="23505")return json({error:"Este CNPJ acabou de ser cadastrado por outra conta. Faça o cadastro novamente para solicitar aprovação do Administrador da empresa.",code:"CNPJ_ALREADY_REGISTERED"},409)
    throw org.error
   }
   const member=await admin.from("organization_members").insert({organization_id:org.data.id,user_id:userId,role:onboardingType==="trial"?"admin":"owner",is_active:true,display_name:(fullName||organizationName).slice(0,80)})
   if(member.error)throw member.error
   const settings=await admin.from("organization_settings").insert({organization_id:org.data.id,default_city:null,default_state:null,feature_flags:{leads:true,capture:true,messages:true,whatsapp:true,campaigns:true,ai_assistant:true},google_places_leads_per_capture:40,google_places_calls_per_capture:2})
   if(settings.error)throw settings.error
   const ai=await admin.from("ai_organization_settings").insert({organization_id:org.data.id,enabled:true,daily_message_limit:10,daily_request_limit:10})
   if(ai.error)throw ai.error
   if(onboardingType==="trial"){
     const trialStart=new Date()
     const trialEnd=new Date(trialStart.getTime()+30*24*60*60*1000)
     const plan=await admin.from("user_plan_assignments").insert({organization_id:org.data.id,user_id:userId,plan_id:"free_30_days",status:"active",trial_started_at:trialStart.toISOString(),trial_ends_at:trialEnd.toISOString(),assigned_by:userId})
     if(plan.error)throw plan.error
     const terms=await admin.from("axiva_trial_terms_acceptances").insert({user_id:userId,organization_id:org.data.id,cnpj,email,terms_version:String(body?.termsVersion||"AXIVA_TRIAL_TERMS_V1").slice(0,100),privacy_version:String(body?.privacyVersion||"AXIVA_PRIVACY_V1").slice(0,100),accepted_at:body?.acceptedAt||trialStart.toISOString(),trial_started_at:trialStart.toISOString(),trial_ends_at:trialEnd.toISOString()})
     if(terms.error)throw terms.error
   }
  }

  const actionLink=data?.properties?.action_link
  if(!actionLink)throw new Error("Não foi possível gerar o link de confirmação.")
  if(!(await sendConfirmation(email,fullName,actionLink,false)))return json({error:"A conta foi criada, mas não foi possível enviar o e-mail de confirmação."},502)
  return json({ok:true,userId})
 }catch(error){
  console.error("signup-with-resend error",error)
  return json({error:"Não foi possível concluir o cadastro. Tente novamente."},500)
 }
}

Deno.serve(async(req)=>{
 const res=await handle(req)
 res.headers.set("Access-Control-Allow-Origin",corsOriginFor(req.headers.get("Origin")||""))
 res.headers.append("Vary","Origin")
 return res
})
