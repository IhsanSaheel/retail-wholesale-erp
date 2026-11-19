import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{error:"Method not allowed"});
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return reply(401,{error:"Sign in as the business owner first."});
 const url=Deno.env.get("SUPABASE_URL");const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!serviceKey)return reply(500,{error:"Employee provisioning is not configured on the server."});
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await admin.auth.getUser(token);
 if(authError||!authData.user)return reply(401,{error:"Your session is invalid or expired. Sign in again."});
 const body=await req.json().catch(()=>null);if(!body)return reply(400,{error:"Invalid request body."});
 const {org_id,email,password,full_name,employee_code,phone,designation,base_salary,role,branch_ids,permissions}=body;
 if(!org_id||!email||!password||!full_name?.trim()||!employee_code?.trim())return reply(400,{error:"Business, email, temporary password, full name and employee code are required."});
 if(String(password).length<12)return reply(400,{error:"Temporary password must be at least 12 characters."});
 if(!["manager","cashier","stockkeeper","accountant"].includes(role))return reply(400,{error:"Choose an allowed employee role."});
 if(!Array.isArray(branch_ids)||branch_ids.length===0||branch_ids.some((x:string)=>typeof x!=="string"))return reply(400,{error:"Assign at least one branch."});
 const {data:membership,error:memberError}=await admin.from("etihad_memberships").select("role,active").eq("org_id",org_id).eq("user_id",authData.user.id).maybeSingle();
 if(memberError||!membership?.active||membership.role!=="owner")return reply(403,{error:"Only the active business owner can create employee accounts."});
 const uniqueBranches=[...new Set(branch_ids)];
 const {data:branchRows,error:branchError}=await admin.from("etihad_records").select("record_id").eq("org_id",org_id).eq("collection","mberp_branches").in("record_id",uniqueBranches);
 if(branchError||!branchRows||branchRows.length!==uniqueBranches.length)return reply(400,{error:"One or more selected branches do not belong to this business."});
 const allowedPermissions=["sales","customers","products","purchases","suppliers","payments","expenses","reports","employees","returns","transfers"];
 const cleanPermissions:Record<string,boolean>={};
 if(Array.isArray(permissions)){for(const k of allowedPermissions){if(permissions.includes(k))cleanPermissions[k]=true;}if(permissions.includes("transfers"))cleanPermissions.stock=true;if(permissions.includes("returns"))cleanPermissions.sales_returns=true;if(permissions.includes("customers")){cleanPermissions.customer_balances=true;cleanPermissions.customer_account_credits=true;}if(permissions.includes("suppliers")){cleanPermissions.supplier_payments=true;cleanPermissions.supplier_returns=true;}}

 const normalizedEmail=String(email).trim().toLowerCase();
 const {data:created,error:createError}=await admin.auth.admin.createUser({email:normalizedEmail,password:String(password),email_confirm:true,user_metadata:{full_name:String(full_name).trim()}});
 if(createError||!created.user)return reply(400,{error:createError?.message||"Could not create the employee login."});
 const userId=created.user.id;
 const {error:membershipInsertError}=await admin.from("etihad_memberships").insert({org_id,user_id:userId,role,branch_ids:uniqueBranches,permissions:cleanPermissions});
 if(membershipInsertError){await admin.auth.admin.deleteUser(userId);return reply(400,{error:"Login created but membership could not be saved; the new login was rolled back. "+membershipInsertError.message});}
 const {error:profileError}=await admin.from("etihad_employee_profiles").insert({org_id,user_id:userId,employee_code:String(employee_code).trim(),full_name:String(full_name).trim(),email:normalizedEmail,phone:String(phone||""),designation:String(designation||""),base_salary:Math.max(0,Number(base_salary)||0),pay_frequency:"monthly",payment_method:"Cash"});
 if(profileError){await admin.from("etihad_memberships").delete().eq("org_id",org_id).eq("user_id",userId);await admin.auth.admin.deleteUser(userId);return reply(400,{error:"Employee profile could not be saved; the new login was rolled back. "+profileError.message});}
 return reply(200,{success:true,userId,email:normalizedEmail,role,branchIds:uniqueBranches,permissions:cleanPermissions,message:"Employee login, membership and profile created."});
});