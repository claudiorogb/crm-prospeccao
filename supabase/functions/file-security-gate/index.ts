import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_SIZES: Record<string, number> = {
  "whatsapp-media": 8 * 1024 * 1024,
  "email-campaign-attachments": 10 * 1024 * 1024,
};
const ALLOWED_BUCKETS = new Set(Object.keys(MAX_SIZES));
const DANGEROUS_EXTENSIONS = new Set([
  "exe","dll","com","scr","msi","msp","msix","appx","apk","dmg","iso","bat","cmd","ps1","psm1",
  "vbs","vbe","js","jse","mjs","cjs","sh","bash","zsh","fish","php","php3","php4","php5","phtml",
  "py","pyc","rb","pl","cgi","jar","class","hta","lnk","url","reg","wsf","wsh","sct","inf","sys","drv","elf","bin"
]);
const BLOCKED_ACTIVE_DOCUMENT_EXTENSIONS = new Set([
  "html","htm","xhtml","svg","xml","xsl","xslt","docm","dotm","xlsm","xltm","pptm","potm","ppsm","ppam"
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function safeFileName(value: unknown) {
  return String(value || "arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "arquivo";
}
function extension(name: string) {
  const clean = safeFileName(name).toLowerCase(); const dot = clean.lastIndexOf(".");
  return dot > -1 ? clean.slice(dot + 1) : "";
}
function bytesFromBase64(value: string) {
  const clean = String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("Arquivo em formato inválido.");
  const binary = atob(clean); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function starts(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}
function ascii(bytes: Uint8Array, max = 8192) {
  return new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, max)));
}
function looksLikeKnownType(bytes: Uint8Array, mime: string, ext: string) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg" || ["jpg","jpeg"].includes(ext)) return starts(bytes, [0xff,0xd8,0xff]);
  if (m === "image/png" || ext === "png") return starts(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (m === "image/gif" || ext === "gif") return ascii(bytes, 6).startsWith("GIF8");
  if (m === "image/webp" || ext === "webp") return ascii(bytes.slice(0,12), 12).startsWith("RIFF") && ascii(bytes.slice(8,12), 4) === "WEBP";
  if (m === "image/bmp" || ext === "bmp") return ascii(bytes, 2) === "BM";
  if (m === "application/pdf" || ext === "pdf") return ascii(bytes, 5) === "%PDF-";
  if (m.includes("wordprocessingml.document") || ext === "docx") return starts(bytes, [0x50,0x4b,0x03,0x04]);
  if (m.includes("spreadsheetml.sheet") || ext === "xlsx") return starts(bytes, [0x50,0x4b,0x03,0x04]);
  if (m.includes("presentationml.presentation") || ext === "pptx") return starts(bytes, [0x50,0x4b,0x03,0x04]);
  if (m === "text/plain" || m === "text/csv" || ["txt","csv"].includes(ext)) return true;
  if (m.startsWith("audio/")) {
    if (starts(bytes, [0x4f,0x67,0x67,0x53]) || ascii(bytes, 3) === "ID3") return true;
    if (starts(bytes, [0x52,0x49,0x46,0x46]) && ascii(bytes.slice(8,12), 4) === "WAVE") return true;
    if (starts(bytes, [0xff,0xfb]) || starts(bytes, [0xff,0xf3]) || starts(bytes, [0xff,0xf2])) return true;
  }
  if (m.startsWith("video/")) {
    if (ascii(bytes.slice(4,8), 4) === "ftyp") return true;
    if (starts(bytes, [0x1a,0x45,0xdf,0xa3])) return true;
    if (starts(bytes, [0x52,0x49,0x46,0x46]) && ascii(bytes.slice(8,12), 4) === "AVI ") return true;
  }
  return false;
}
function validateFile(bytes: Uint8Array, fileName: string, mimeType: string) {
  const ext = extension(fileName); const mime = String(mimeType || "").toLowerCase(); const findings: string[] = [];
  if (DANGEROUS_EXTENSIONS.has(ext)) findings.push("dangerous_extension");
  if (BLOCKED_ACTIVE_DOCUMENT_EXTENSIONS.has(ext)) findings.push("active_content_extension");
  if (mime === "application/octet-stream") findings.push("generic_binary_mime");
  const head = ascii(bytes, 8192);
  if (head.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) findings.push("eicar_test_signature");
  if (starts(bytes, [0x4d,0x5a])) findings.push("portable_executable");
  if (starts(bytes, [0x7f,0x45,0x4c,0x46])) findings.push("elf_executable");
  if (starts(bytes, [0xcf,0xfa,0xed,0xfe]) || starts(bytes, [0xfe,0xed,0xfa,0xcf]) || starts(bytes, [0xca,0xfe,0xba,0xbe]) || starts(bytes, [0xbe,0xba,0xfe,0xca])) findings.push("mach_o_or_fat_executable");
  if (starts(bytes, [0x23,0x21]) || head.toLowerCase().includes("<script") || head.toLowerCase().includes("<!doctype html") || head.toLowerCase().includes("<html")) findings.push("script_or_html_content");
  if (ext === "pdf" || mime === "application/pdf") {
    if (/\/JavaScript|\/JS|\/OpenAction|\/AA|\/Launch/i.test(head)) findings.push("pdf_active_content_marker");
  }
  if (!looksLikeKnownType(bytes, mime, ext) && !["application/zip","application/x-zip-compressed"].includes(mime)) findings.push("content_type_mismatch");
  return { allowed: findings.length === 0, findings };
}
async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function isOrganizationMember(admin: any, organizationId: string, userId: string) {
  const { data } = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId)
    .eq("user_id", userId).eq("is_active", true).is("deleted_at", null).maybeSingle();
  return Boolean(data?.user_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL"); const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server not configured" }, 503);
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7);
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData } = await admin.auth.getUser(token);
  const caller = userData?.user || null; const isServiceRole = caller?.role === "service_role" || token === serviceRole;
  let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const organizationId = String(body?.organization_id || ""); const targetBucket = String(body?.target_bucket || "");
  const targetPath = String(body?.target_path || ""); const fileName = safeFileName(body?.file_name || "arquivo");
  const mimeType = String(body?.mime_type || "application/octet-stream").toLowerCase();
  const source = String(body?.source || "unknown").slice(0, 80); const base64 = String(body?.base64 || "");

  if (!organizationId || !ALLOWED_BUCKETS.has(targetBucket) || !targetPath || !base64) return json({ error: "Dados do arquivo incompletos." }, 400);
  if (!targetPath.startsWith(organizationId + "/") || targetPath.includes("..")) return json({ error: "Caminho de arquivo inválido." }, 400);
  if (!isServiceRole) {
    if (!caller?.id) return json({ error: "Unauthorized" }, 401);
    if (!(await isOrganizationMember(admin, organizationId, caller.id))) return json({ error: "Você não pertence à empresa ativa." }, 403);
  }

  let bytes: Uint8Array; try { bytes = bytesFromBase64(base64); } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Arquivo inválido." }, 400);
  }
  const maxSize = MAX_SIZES[targetBucket];
  if (bytes.byteLength === 0) return json({ error: "Arquivo vazio." }, 400);
  if (bytes.byteLength > maxSize) return json({ error: "O arquivo excede o limite permitido." }, 413);

  const digest = await sha256(bytes); const validation = validateFile(bytes, fileName, mimeType);
  const quarantinePath = organizationId + "/" + crypto.randomUUID() + "-" + fileName;

  const { data: scan, error: scanInsertError } = await admin.from("file_security_scans").insert({
    organization_id: organizationId, user_id: isServiceRole ? (body?.user_id || null) : caller?.id || null,
    source, target_bucket: targetBucket, target_path: targetPath, quarantine_path: quarantinePath,
    original_file_name: fileName, mime_type: mimeType, size_bytes: bytes.byteLength, sha256: digest,
    policy_status: validation.allowed ? "allowed" : "blocked", antivirus_status: "not_configured",
    scan_engine: "builtin-policy", findings: validation.findings,
  }).select("id").single();
  if (scanInsertError) return json({ error: "Não foi possível registrar a análise de segurança." }, 500);

  const { error: quarantineError } = await admin.storage.from("file-quarantine").upload(quarantinePath, bytes, {
    contentType: mimeType, upsert: false, cacheControl: "0",
  });
  if (quarantineError) {
    await admin.from("file_security_scans").update({ policy_status: "error", findings: [...validation.findings, "quarantine_upload_failed"] }).eq("id", scan.id);
    return json({ error: "Não foi possível colocar o arquivo em quarentena." }, 500);
  }

  if (!validation.allowed) {
    return json({ ok: false, blocked: true, scan_id: scan.id, findings: validation.findings, antivirus_status: "not_configured",
      message: "O arquivo foi bloqueado pela camada de segurança do AXIVA CRM." }, 422);
  }

  const { error: moveError } = await admin.storage.from("file-quarantine").move(quarantinePath, targetPath, { destinationBucket: targetBucket });
  if (moveError) {
    await admin.from("file_security_scans").update({ policy_status: "error", findings: [...validation.findings, "final_storage_move_failed"] }).eq("id", scan.id);
    return json({ error: "O arquivo passou pela validação, mas não pôde ser liberado para o armazenamento definitivo." }, 500);
  }

  await admin.from("file_security_scans").update({ policy_status: "allowed", quarantine_path: null }).eq("id", scan.id);
  return json({ ok: true, blocked: false, scan_id: scan.id, storage_path: targetPath, sha256: digest,
    size_bytes: bytes.byteLength, antivirus_status: "not_configured", security_layer: "builtin-policy" });
});
