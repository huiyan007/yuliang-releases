package cn.yuliang.finance.test;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Reads only the image the user selects or shares, without media library access. */
public final class OcrBridge {
    static final int PICK_IMAGE = 3;
    private static final long MAX_FILE_BYTES = 30L * 1024 * 1024;
    private static final long MAX_DECODE_PIXELS = 12_000_000;
    private final Activity activity;
    private final WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String pickerRequest;
    private boolean busy;
    private boolean pageReady;
    private boolean closed;
    private JSONObject pendingShare;

    OcrBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @JavascriptInterface public void pickImage(String requestId) {
        if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{1,80}")) return;
        activity.runOnUiThread(() -> {
            if (closed) return;
            if (pickerRequest != null || busy) {
                deliver(false, failed(requestId, "请等待当前图片处理完成。", false));
                return;
            }
            pickerRequest = requestId;
            if (Build.VERSION.SDK_INT >= 33) {
                try {
                    activity.startActivityForResult(new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*"), PICK_IMAGE);
                    return;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // Some devices do not ship the system photo picker.
                }
            }
            try {
                Intent fallback = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*");
                fallback.addCategory(Intent.CATEGORY_OPENABLE);
                activity.startActivityForResult(fallback, PICK_IMAGE);
            } catch (ActivityNotFoundException | SecurityException e) {
                pickerRequest = null;
                deliver(false, failed(requestId, "无法打开系统图片选择器。", false));
            }
        });
    }

    void onPickerResult(int result, Intent intent) {
        String requestId = pickerRequest;
        pickerRequest = null;
        if (requestId == null || closed) return;
        if (result != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            deliver(false, failed(requestId, "", true));
            return;
        }
        recognize(intent.getData(), requestId, false);
    }

    void onSharedIntent(Intent intent) {
        if (closed || intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String mime = intent.getType();
        if (mime == null || !mime.startsWith("image/")) return;
        Uri image = null;
        try {
            if (Build.VERSION.SDK_INT >= 33) image = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            else {
                Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream instanceof Uri) image = (Uri) stream;
            }
            if (image == null && intent.getClipData() != null && intent.getClipData().getItemCount() == 1) {
                image = intent.getClipData().getItemAt(0).getUri();
            }
        } catch (RuntimeException ignored) {
            // Malformed or unsupported share payload.
        }
        recognize(image, "share-" + System.nanoTime(), true);
    }

    private void recognize(Uri uri, String requestId, boolean shared) {
        if (uri == null || !"content".equals(uri.getScheme())) {
            deliver(shared, failed(requestId, "无法读取这张截图。请从相册选择图片。", false));
            return;
        }
        if (busy) {
            deliver(shared, failed(requestId, "请等待当前图片处理完成。", false));
            return;
        }
        busy = true;
        worker.execute(() -> {
            JSONObject result;
            Bitmap bitmap = null;
            try {
                bitmap = loadImage(uri);
                boolean paymentPicker = requestId.startsWith("payment-");
                JSONArray lines = paymentPicker ? new JSONArray() : ScreenshotOcr.recognize(bitmap);
                String imagePreview = preview(bitmap);
                result = new JSONObject();
                result.put("requestId", requestId);
                result.put("ok", true);
                result.put("width", bitmap.getWidth());
                result.put("height", bitmap.getHeight());
                result.put("lines", lines);
                result.put("preview", imagePreview);
                if (shared || paymentPicker) {
                    result.put("paymentLines", ScreenshotOcr.recognizePayment(bitmap));
                    byte[] hash = MessageDigest.getInstance("SHA-256").digest(imagePreview.getBytes(StandardCharsets.US_ASCII));
                    StringBuilder hex = new StringBuilder();
                    for (byte value : hash) hex.append(Character.forDigit((value & 255) >> 4, 16)).append(Character.forDigit(value & 15, 16));
                    result.put("imageId", hex.toString());
                }
                result.put("engine", "offline-summary");
                result.put("notice", "首版适配浅色分类汇总截图，请核对金额及是否有漏项。");
            } catch (OutOfMemoryError e) {
                result = failed(requestId, "图片过大，请裁剪到账单分类列表后重试。", false);
            } catch (SecurityException e) {
                result = failed(requestId, "图片访问已失效，请重新选择。", false);
            } catch (IOException e) {
                result = failed(requestId, e.getMessage(), false);
            } catch (Exception e) {
                result = failed(requestId, "这张图片识别失败，请试试清晰的分类支出截图。", false);
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
            JSONObject response = result;
            activity.runOnUiThread(() -> {
                busy = false;
                deliver(shared, response);
            });
        });
    }

    private Bitmap loadImage(Uri uri) throws IOException {
        try (ParcelFileDescriptor source = activity.getContentResolver().openFileDescriptor(uri, "r")) {
            if (source != null && source.getStatSize() > MAX_FILE_BYTES) {
                throw new IOException("图片过大，请裁剪到账单分类列表后重试。");
            }
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("无法打开图片。请重新选择。");
            BitmapFactory.decodeStream(in, null, options);
        }
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            throw new IOException("不支持这张图片，请选择 PNG 或 JPEG 截图。");
        }
        if (options.outWidth > 16_000 || options.outHeight > 50_000) {
            throw new IOException("图片过长或过宽，请裁剪到账单分类列表后重试。");
        }
        options.inJustDecodeBounds = false;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        options.inSampleSize = 1;
        while (options.outWidth / options.inSampleSize > 1800
                || (long) options.outWidth * options.outHeight / options.inSampleSize / options.inSampleSize > MAX_DECODE_PIXELS) {
            options.inSampleSize *= 2;
        }
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try (InputStream metadata = activity.getContentResolver().openInputStream(uri)) {
            if (metadata != null) orientation = new ExifInterface(metadata)
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (IOException ignored) {
            // Plain screenshots may not have EXIF metadata.
        }
        try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
            Bitmap bitmap = in == null ? null : BitmapFactory.decodeStream(in, null, options);
            if (bitmap == null) throw new IOException("图片损坏或无法读取，请重新截图。");
            Matrix rotation = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: rotation.setScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_180: rotation.setRotate(180); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: rotation.setScale(1, -1); break;
                case ExifInterface.ORIENTATION_TRANSPOSE: rotation.setRotate(90); rotation.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_90: rotation.setRotate(90); break;
                case ExifInterface.ORIENTATION_TRANSVERSE: rotation.setRotate(-90); rotation.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_270: rotation.setRotate(-90); break;
                default: return bitmap;
            }
            try {
                Bitmap corrected = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), rotation, true);
                if (corrected != bitmap) bitmap.recycle();
                return corrected;
            } catch (RuntimeException | OutOfMemoryError e) {
                bitmap.recycle();
                throw e;
            }
        }
    }

    private static String preview(Bitmap bitmap) throws IOException {
        double scale = Math.min(1, Math.min(820.0 / bitmap.getWidth(), 2600.0 / bitmap.getHeight()));
        Bitmap scaled = scale == 1 ? bitmap : Bitmap.createScaledBitmap(bitmap,
                Math.max(1, (int) Math.round(bitmap.getWidth() * scale)),
                Math.max(1, (int) Math.round(bitmap.getHeight() * scale)), true);
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            if (!scaled.compress(Bitmap.CompressFormat.JPEG, 75, bytes)) throw new IOException("无法生成截图预览。");
            return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally {
            if (scaled != bitmap) scaled.recycle();
        }
    }

    private static JSONObject failed(String requestId, String error, boolean cancelled) {
        JSONObject result = new JSONObject();
        try {
            result.put("requestId", requestId);
            result.put("ok", false);
            result.put("error", error == null ? "图片无法读取。" : error);
            result.put("cancelled", cancelled);
        } catch (JSONException impossible) { throw new AssertionError(impossible); }
        return result;
    }

    void onPageReady() {
        if (closed) return;
        pageReady = true;
        if (pendingShare != null) {
            JSONObject shared = pendingShare;
            pendingShare = null;
            deliver(true, shared);
        }
    }

    private void deliver(boolean shared, JSONObject result) {
        if (closed) return;
        if (!pageReady) {
            if (shared) pendingShare = result;
            return;
        }
        String callback = shared ? "onAndroidOcrShared" : "onAndroidOcrResult";
        // Serialize as JSON. OCR content is data, never evaluated as source code.
        String payload = JSONObject.quote(result.toString()).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        web.evaluateJavascript("if(typeof window." + callback + "==='function')window." + callback + "(JSON.parse(" + payload + "));", null);
    }

    void close() {
        closed = true;
        pendingShare = null;
        pickerRequest = null;
        worker.shutdownNow();
    }
}
