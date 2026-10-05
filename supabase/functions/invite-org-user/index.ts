import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:H});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";if(!url||!service)return json({error:"Serviço indisponível."},503);
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const h=req.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))return json({error:"Sessão inválida."},401);
  const {data:me,error:meError}=await admin.auth.getUser(h.slice(7));if(meError||!me?.user)return json({error:"Sessão inválida."},401);
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",me.user.id).eq("is_active",true).is("deleted_at",null).order("created_at",{ascending:true}).limit(1).maybeSingle();
  if(!membership||!["owner","admin"].includes(membership.role))return json({error:"Somente o proprietário ou administrador pode adicionar usuários."},403);
  let body:any={};try{body=await req.json()}catch{}const email=String(body?.email||"").trim().toLowerCase(),name=String(body?.name||"").trim();
  if(!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email))return json({error:"Informe um e-mail válido."},400);if(name.length<2)return json({error:"Informe o nome do usuário."},400);
  const orgId=membership.organization_id;
  const {data:existingMembers}=await admin.from("organization_members").select("user_id").eq("organization_id",orgId).eq("is_active",true).is("deleted_at",null);
  const {data:usersPage}=await admin.auth.admin.listUsers({page:1,perPage:1000});
  const existingUser=(usersPage?.users||[]).find((u:any)=>String(u.email||"").toLowerCase()===email);
  if(existingUser){
    if((existingMembers||[]).some((m:any)=>m.user_id===existingUser.id))return json({error:"Este usuário já pertence à empresa."},409);
    const {error}=await admin.from("organization_members").insert({organization_id:orgId,user_id:existingUser.id,role:"user",is_active:true,display_name:name});if(error)return json({error:"Não foi possível vincular o usuário à empresa."},500);
    return json({ok:true,invited:false});
  }
  const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{data:{full_name:name},redirectTo:"https://crm.axiva.com.br/"});
  if(inviteError||!invited?.user)return json({error:inviteError?.message||"Não foi possível enviar o convite."},400);
  const {error:memberError}=await admin.from("organization_members").insert({organization_id:orgId,user_id:invited.user.id,role:"user",is_active:true,display_name:name});
  if(memberError){await admin.auth.admin.deleteUser(invited.user.id);return json({error:"Não foi possível vincular o usuário à empresa."},500)}
  return json({ok:true,invited:true});
 }catch(e){return json({error:"Não foi possível adicionar o usuário.",details:String(e?.message||e).slice(0,180)},500)}
});