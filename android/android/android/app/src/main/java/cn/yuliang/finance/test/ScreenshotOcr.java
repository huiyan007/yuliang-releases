package cn.yuliang.finance.test;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import org.json.JSONArray;
import org.json.JSONObject;

final class ScreenshotOcr {
    static JSONArray recognize(Bitmap bitmap) throws Exception {
        int width = bitmap.getWidth(), height = bitmap.getHeight();
        int[] argb = new int[width * height];
        bitmap.getPixels(argb, 0, width, 0, 0, width, height);
        return lines(ScreenshotOcrCore.recognize(width, height, argb, ScreenshotOcr::render, PresetGlyphs.all()));
    }

    static JSONArray recognizePayment(Bitmap bitmap) throws Exception {
        int width = bitmap.getWidth(), height = bitmap.getHeight();
        int[] argb = new int[width * height];
        bitmap.getPixels(argb, 0, width, 0, 0, width, height);
        return lines(ScreenshotOcrCore.recognizePayment(width, height, argb, ScreenshotOcr::render, PresetGlyphs.all()));
    }

    private static JSONArray lines(java.util.List<ScreenshotOcrCore.Token> tokens) throws Exception {
        JSONArray lines = new JSONArray();
        for (ScreenshotOcrCore.Token token : tokens) {
            JSONObject line = new JSONObject();
            line.put("text", token.text);
            line.put("left", token.left);
            line.put("top", token.top);
            line.put("right", token.right);
            line.put("bottom", token.bottom);
            lines.put(line);
        }
        return lines;
    }

    private static ScreenshotOcrCore.Mask render(String text, boolean bold) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextSize(64);
        paint.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        paint.setTextLocale(java.util.Locale.SIMPLIFIED_CHINESE);
        Paint.FontMetrics font = paint.getFontMetrics();
        int width = Math.max(1, (int) Math.ceil(paint.measureText(text)) + 20);
        int height = Math.max(1, (int) Math.ceil(font.bottom - font.top) + 20);
        Bitmap sample = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(sample);
            canvas.drawColor(Color.WHITE);
            canvas.drawText(text, 10, 10 - font.top, paint);
            int[] pixels = new int[width * height];
            sample.getPixels(pixels, 0, width, 0, 0, width, height);
            boolean[] ink = new boolean[pixels.length];
            for (int i = 0; i < pixels.length; i++) ink[i] = (pixels[i] & 255) < 153;
            return new ScreenshotOcrCore.Mask(width, height, ink);
        } finally {
            sample.recycle();
        }
    }
}
