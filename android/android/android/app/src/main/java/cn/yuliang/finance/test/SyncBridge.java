package cn.yuliang.finance.test;
import android.app.Activity;import android.content.*;import android.webkit.*;import android.security.keystore.*;import android.util.Base64;import org.json.*;import javax.crypto.*;import javax.crypto.spec.GCMParameterSpec;import java.security.*;import javax.net.ssl.*;import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.*;
public class SyncBridge {
 final Context context;final WebView web;final SharedPreferences prefs;final ExecutorService worker=Executors.newSingleThreadExecutor();final UpdateManager updates;
 SyncBridge(Activity c,WebView w){context=c;web=w;prefs=c.getSharedPreferences("dav-v02",Context.MODE_PRIVATE);updates=new UpdateManager(c);}
 @JavascriptInterface public void call(String id,String route,String body){worker.execute(()->{JSONObject result;try{result=handle(route,new JSONObject(body));}catch(Exception e){result=new JSONObject();try{result.put("status","error").put("message",e.getMessage()==null?"同步失败，请检查网络":e.getMessage());}catch(Exception ignored){}}final String js="window.mobileNativeResult("+JSONObject.quote(id)+","+result.toString()+")";web.post(()->web.evaluateJavascript(js,null));});}
 JSONObject ok()throws Exception{return new JSONObject().put("status","ok");}
 SecretKey key()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias("yuliang-dav")){KeyGenerator gen=KeyGenerator.getInstance("AES","AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder("yuliang-dav",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();}return (SecretKey)store.getKey("yuliang-dav",null);}
 String encrypt(String value)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);}
 String password()throws Exception{String s=prefs.getString("secret","");if(s.isEmpty())return "";String[] p=s.split(":");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return new String(c.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
 String identity()throws Exception{return hash(prefs.getString("server","")+"|"+prefs.getString("user",""));}
 static String hash(String s)throws Exception{StringBuilder b=new StringBuilder();for(byte x:MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)))b.append(String.format("%02X",x));return b.toString();}
 JSONObject handle(String route,JSONObject d)throws Exception{
 if(route.equals("/updates/check"))return updates.check();
 if(route.equals("/updates/download"))return updates.startDownload(d.getString("version"));
 if(route.equals("/updates/progress"))return updates.packageStatus();
 if(route.equals("/updates/install"))return updates.install(d.getString("version"));
 if(route.equals("/updates/open-release"))return updates.openReleasePage();
 if(route.equals("/config")){
  if(d.has("server")){String server=d.getString("server").trim();if(!server.endsWith("/"))server+="/";URI u=new URI(server);if(!"https".equals(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null)throw new Exception("请填写有效的 HTTPS WebDAV 地址");String user=d.optString("user").trim(),pw=d.optString("password");if(user.isEmpty())throw new Exception("请填写账号");if(pw.isEmpty()){if(!server.equals(prefs.getString("server",""))||!user.equals(prefs.getString("user","")))throw new Exception("更换地址或账号时请重新填写应用密码");pw=password();}if(pw.isEmpty())throw new Exception("请填写应用密码");String secret=encrypt(pw);if(!prefs.edit().putString("server",server).putString("user",user).putString("secret",secret).commit())throw new Exception("配置保存失败");return ok().put("message","配置已在手机加密保存");}
  return ok().put("server",prefs.getString("server","")).put("user",prefs.getString("user","")).put("hasPassword",!prefs.getString("secret","").isEmpty());
 }
 if(route.equals("/disconnect")){prefs.edit().remove("server").remove("user").remove("secret").commit();return ok();}
 if(route.equals("/baseline")){String value=prefs.getString("baseline-"+identity(),"{}");return new JSONObject(value);}
 if(route.equals("/ack")){if(!prefs.edit().putString("baseline-"+identity(),new JSONObject().put("revision",d.getString("revision")).put("hash",d.getString("hash")).toString()).commit())throw new Exception("同步状态保存失败");return ok();}
 if(route.equals("/backup")){String data=d.getString("data");new JSONObject(data);if(data.length()>4*1024*1024)throw new Exception("账本过大");File dir=new File(context.getFilesDir(),"Backups");if(!dir.exists()&&!dir.mkdirs())throw new Exception("备份目录创建失败");String tag=d.optString("tag").replaceAll("[^a-z-]","");try(FileOutputStream out=new FileOutputStream(new File(dir,System.currentTimeMillis()+"-"+java.util.UUID.randomUUID()+"-"+tag+".json"))){out.write(data.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}return ok();}
 if(route.equals("/request"))return request(d);
 throw new Exception("未知操作");
 }
 void close(){worker.shutdownNow();updates.close();}
 static String line(InputStream in)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();int c;while((c=in.read())!=-1){if(c==10)break;if(c!=13)b.write(c);if(b.size()>16384)throw new Exception("响应头过大");}if(c==-1&&b.size()==0)return null;return b.toString("ISO-8859-1");}
 static void copyCount(InputStream in,OutputStream out,long n)throws Exception{byte[] buf=new byte[8192];while(n>0){int count=in.read(buf,0,(int)Math.min(buf.length,n));if(count<0)throw new IOException("连接提前断开");out.write(buf,0,count);n-=count;}}
 JSONObject request(JSONObject d)throws Exception{
 String server=prefs.getString("server",""),user=prefs.getString("user",""),pw=password();if(server.isEmpty()||pw.isEmpty())throw new Exception("请先保存同步配置");String method=d.getString("method"),suffix=d.optString("suffix");if(!java.util.Arrays.asList("GET","PUT","PROPFIND","MKCOL").contains(method)||!java.util.Arrays.asList("","YuliangFinance/","YuliangFinance/state.json").contains(suffix))throw new Exception("请求无效");URI u=new URI(server+suffix);int port=u.getPort()<0?443:u.getPort();String host=u.getHost();
 try(java.net.Socket tcp=new java.net.Socket()){
 tcp.connect(new InetSocketAddress(host,port),20000);tcp.setSoTimeout(20000);
 try(SSLSocket s=(SSLSocket)((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(tcp,host,port,true)){
 SSLParameters params=s.getSSLParameters();params.setEndpointIdentificationAlgorithm("HTTPS");s.setSSLParameters(params);s.setSoTimeout(20000);s.startHandshake();
 String body=method.equals("PROPFIND")?"<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>":d.optString("body");byte[] bytes=body.getBytes(StandardCharsets.UTF_8);if(bytes.length>4*1024*1024)throw new Exception("上传文件超过 4MB");String target=u.getRawPath();if(target==null||target.isEmpty())target="/";
 String headers=method+" "+target+" HTTP/1.1\r\nHost: "+host+(port==443?"":":"+port)+"\r\nAuthorization: Basic "+Base64.encodeToString((user+":"+pw).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP)+"\r\nConnection: close\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nUser-Agent: YuliangAndroid/0.2\r\n";
 if(method.equals("PROPFIND"))headers+="Depth: 0\r\n";
 String condition=d.optString("condition");if(condition.contains("\r")||condition.contains("\n"))throw new Exception("版本标记无效");if(!condition.isEmpty())headers+=(condition.equals("*")?"If-None-Match: ":"If-Match: ")+condition+"\r\n";
 if(method.equals("PUT")||method.equals("PROPFIND")||method.equals("MKCOL"))headers+="Content-Type: "+(method.equals("PROPFIND")?"application/xml":"application/json")+"; charset=utf-8\r\nContent-Length: "+bytes.length+"\r\n";
 OutputStream output=s.getOutputStream();output.write((headers+"\r\n").getBytes(StandardCharsets.ISO_8859_1));if(method.equals("PUT")||method.equals("PROPFIND"))output.write(bytes);output.flush();
 InputStream in=new BufferedInputStream(s.getInputStream());String status=line(in);if(status==null||!status.startsWith("HTTP/"))throw new Exception("云端响应无效");int code=Integer.parseInt(status.split(" ")[1]);String etag="",transfer="";long length=-1;String l;int headerCount=0;while((l=line(in))!=null&&!l.isEmpty()){if(++headerCount>200)throw new Exception("响应头过多");int at=l.indexOf(':');if(at<0)continue;String n=l.substring(0,at).trim().toLowerCase(java.util.Locale.ROOT),v=l.substring(at+1).trim();if(n.equals("etag"))etag=v;if(n.equals("transfer-encoding"))transfer=v;if(n.equals("content-length"))length=Long.parseLong(v);}
 ByteArrayOutputStream response=new ByteArrayOutputStream();final int limit=4*1024*1024;if(transfer.toLowerCase(java.util.Locale.ROOT).contains("chunked")){while(true){String size=line(in);if(size==null)throw new Exception("响应中断");long n=Long.parseLong(size.split(";")[0].trim(),16);if(n==0)break;if(n<0||response.size()+n>limit)throw new Exception("响应超过 4MB");copyCount(in,response,n);line(in);}}else if(length>=0){if(length>limit)throw new Exception("响应超过 4MB");copyCount(in,response,length);}else{byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(response.size()+n>limit)throw new Exception("响应超过 4MB");response.write(buf,0,n);}}
 return ok().put("code",code).put("body",response.toString("UTF-8")).put("etag",etag);
 }}
 }
}
