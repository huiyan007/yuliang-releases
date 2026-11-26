package cn.yuliang.finance.test;
import android.app.*;import android.os.*;import android.content.*;import android.net.Uri;import android.webkit.*;import java.io.*;import java.nio.charset.StandardCharsets;
import android.content.res.Configuration;
import android.graphics.Color;
import android.view.View;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
public class MainActivity extends Activity {
 WebView web; ValueCallback<Uri[]> chooser; String pending; OcrBridge ocr; SyncBridge sync;
 private FrameLayout frame;
 private boolean darkTheme;
 private boolean backPending;
 private OnBackInvokedCallback backCallback;

 public void onCreate(Bundle state){super.onCreate(state);web=new WebView(this);
 frame=new FrameLayout(this);
 frame.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));
 setContentView(frame);
 applySystemBars(isSystemDark());
 web.addJavascriptInterface(new AppearanceBridge(), "AndroidAppearance");
 if (Build.VERSION.SDK_INT >= 33) {
  backCallback = this::handleBack;
  getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
 }
 sync=new SyncBridge(this,web);web.addJavascriptInterface(sync,"AndroidSync");
 ocr=new OcrBridge(this,web);
 web.addJavascriptInterface(ocr,"AndroidOcr");
 frame.setOnApplyWindowInsetsListener((v,insets)->{
  int left,top,right,bottom;
  if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()|android.view.WindowInsets.Type.ime());left=safe.left;top=safe.top;right=safe.right;bottom=safe.bottom;}
  else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=0;}
  // Resize the WebView itself: fixed CSS navigation and viewport content stay inside safe bounds.
  android.widget.FrameLayout.LayoutParams lp=(android.widget.FrameLayout.LayoutParams)web.getLayoutParams();
  if(lp.leftMargin!=left||lp.topMargin!=top||lp.rightMargin!=right||lp.bottomMargin!=bottom){lp.setMargins(left,top,right,bottom);web.setLayoutParams(lp);}
  if(Build.VERSION.SDK_INT>=30)return android.view.WindowInsets.CONSUMED;
  return insets.consumeSystemWindowInsets();
 });
 frame.requestApplyInsets();web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.addJavascriptInterface(new Object(){@JavascriptInterface public void save(String json,String name){runOnUiThread(()->{pending=json;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.setType("application/json");i.addCategory(Intent.CATEGORY_OPENABLE);i.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(i,2);});}},"AndroidBackup");
 web.setWebViewClient(new WebViewClient(){public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri u=r.getUrl();if("https".equals(u.getScheme())&&"app.yuliang.local".equals(u.getHost())){String p=u.getPath();if(p==null||p.equals("/"))p="/index.html";if(p.contains(".."))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));try{return new WebResourceResponse(p.endsWith(".css")?"text/css":p.endsWith(".js")?"text/javascript":"text/html","UTF-8",getAssets().open("www"+p));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}}if("data".equals(u.getScheme())&&u.toString().startsWith("data:image/jpeg;base64,"))return null;return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !"app.yuliang.local".equals(r.getUrl().getHost());}public void onPageFinished(WebView v,String url){super.onPageFinished(v,url);if("https://app.yuliang.local/index.html".equals(url))ocr.onPageReady();}});
 web.setWebChromeClient(new WebChromeClient(){
  @Override public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> callback,FileChooserParams params){
   if(chooser!=null)chooser.onReceiveValue(null);
   chooser=callback;
   Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT);
   picker.setType("*/*");
   picker.addCategory(Intent.CATEGORY_OPENABLE);
   try { startActivityForResult(picker,1); }
   catch (ActivityNotFoundException | SecurityException e) {
    chooser=null;
    callback.onReceiveValue(null);
    alertDialog().setMessage("无法打开文件选择器。").setPositiveButton("确定",null).show();
   }
   return true;
  }

  @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
   alertDialog().setMessage(message).setPositiveButton("确定",(d,x)->result.confirm())
     .setOnCancelListener(d->result.cancel()).show();
   return true;
  }

  @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
   alertDialog().setMessage(message).setPositiveButton("确定",(d,x)->result.confirm())
     .setNegativeButton("取消",(d,x)->result.cancel()).setOnCancelListener(d->result.cancel()).show();
   return true;
  }
 });
 web.loadUrl("https://app.yuliang.local/index.html");
 if(state==null)ocr.onSharedIntent(getIntent());
 }

 private boolean isSystemDark() {
  return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
 }

 public final class AppearanceBridge {
  @JavascriptInterface public boolean isSystemDark() { return MainActivity.this.isSystemDark(); }
  @JavascriptInterface public void setDark(boolean dark) {
   runOnUiThread(() -> { if (!isDestroyed()) applySystemBars(dark); });
  }
 }

 private void applySystemBars(boolean dark) {
  darkTheme = dark;
  int color = dark ? Color.rgb(25, 33, 28) : Color.rgb(251, 252, 250);
  frame.setBackgroundColor(color);
  web.setBackgroundColor(color);
  if (Build.VERSION.SDK_INT < 35) {
   getWindow().setStatusBarColor(color);
   getWindow().setNavigationBarColor(color);
  }
  if (Build.VERSION.SDK_INT >= 30) {
   WindowInsetsController controller = getWindow().getInsetsController();
   if (controller != null) {
    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
    controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
   }
  } else {
   View decor = getWindow().getDecorView();
   int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
   decor.setSystemUiVisibility((decor.getSystemUiVisibility() & ~mask) | (dark ? 0 : mask));
  }
 }

 private AlertDialog.Builder alertDialog() {
  return new AlertDialog.Builder(this, darkTheme
    ? android.R.style.Theme_Material_Dialog_Alert : android.R.style.Theme_Material_Light_Dialog_Alert);
 }

 @Override public void onBackPressed() { handleBack(); }

 private void handleBack() {
  if (backPending || web == null || isDestroyed()) return;
  backPending = true;
  web.evaluateJavascript("typeof window.mobileBack === 'function' && window.mobileBack()", handled -> {
   backPending = false;
   if (!isFinishing() && !isDestroyed() && !"true".equals(handled)) super.onBackPressed();
  });
 }

 protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);ocr.onSharedIntent(intent);}
 protected void onDestroy(){if(Build.VERSION.SDK_INT>=33&&backCallback!=null)getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);if(ocr!=null)ocr.close();if(sync!=null)sync.close();if(web!=null){web.removeJavascriptInterface("AndroidSync");web.removeJavascriptInterface("AndroidOcr");web.removeJavascriptInterface("AndroidAppearance");web.destroy();}super.onDestroy();}
 protected void onActivityResult(int req,int result,Intent intent){super.onActivityResult(req,result,intent);if(req==OcrBridge.PICK_IMAGE){ocr.onPickerResult(result,intent);return;}if(req==1&&chooser!=null){Uri selected=result==RESULT_OK&&intent!=null?intent.getData():null;chooser.onReceiveValue(selected!=null?new Uri[]{selected}:null);chooser=null;}if(req==2){if(result==RESULT_OK&&intent!=null&&pending!=null){try(OutputStream o=getContentResolver().openOutputStream(intent.getData())){o.write(pending.getBytes(StandardCharsets.UTF_8));}catch(Exception e){alertDialog().setMessage("备份保存失败："+e.getMessage()).setPositiveButton("确定",null).show();}}pending=null;}}
}
