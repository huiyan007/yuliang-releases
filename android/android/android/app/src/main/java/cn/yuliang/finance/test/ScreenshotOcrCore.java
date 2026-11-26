package cn.yuliang.finance.test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Offline recognition for the category and amount columns of light bill summaries. */
final class ScreenshotOcrCore {
    private static final String[] LABELS = {
        "餐饮", "生活缴费", "娱乐", "购物", "休闲玩乐", "转账", "交通", "出行",
        "缴费", "服务", "其他", "居住缴费", "休闲娱乐", "生活服务", "交通出行", "非消费转出"
    };
    private static final String GLYPHS = "0123456789¥›>";
    private static final String[] PAYMENT_MERCHANTS = {
        "肯德基", "麦当劳", "瑞幸咖啡", "星巴克", "蜜雪冰城", "美团外卖", "饿了么", "滴滴出行", "京东", "淘宝"
    };
    private static final Pattern AMOUNT = Pattern.compile("[¥￥]?[-+]?\\d{1,9}(?:,\\d{3})*\\.\\d{2}");

    interface Rasterizer { Mask render(String text, boolean bold); }

    static final class Mask {
        final int width, height;
        final boolean[] ink;
        Mask(int width, int height, boolean[] ink) {
            this.width = width;
            this.height = height;
            this.ink = ink;
        }
    }

    static final class Token {
        final String text;
        final int left, top, right, bottom;
        Token(String text, Box box) {
            this.text = text;
            left = box.left; top = box.top; right = box.right; bottom = box.bottom;
        }
    }

    private static final class Box {
        final int left, top, right, bottom;
        Box(int left, int top, int right, int bottom) {
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }
        int width() { return right - left; }
        int height() { return bottom - top; }
    }

    private static final class Shape {
        final double aspect;
        final int width, height;
        final float[] pixels;
        Shape(Mask source, Box crop, int width, int height) {
            this.width = width;
            this.height = height;
            aspect = (double) crop.width() / crop.height();
            pixels = new float[width * height];
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int ink = 0;
                    for (int dy = 0; dy < 3; dy++) {
                        int py = crop.top + (int) ((y + (dy + .5) / 3) * crop.height() / height);
                        for (int dx = 0; dx < 3; dx++) {
                            int px = crop.left + (int) ((x + (dx + .5) / 3) * crop.width() / width);
                            if (source.ink[py * source.width + px]) ink++;
                        }
                    }
                    pixels[y * width + x] = ink / 9f;
                }
            }
        }

        double distance(Shape other, double aspectWeight) {
            double best = Double.MAX_VALUE;
            for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                double loss = 0;
                for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                    int ox = x + dx, oy = y + dy;
                    float sample = ox < 0 || ox >= width || oy < 0 || oy >= height ? 0 : other.pixels[oy * width + ox];
                    loss += Math.abs(pixels[y * width + x] - sample);
                }
                best = Math.min(best, loss / pixels.length);
            }
            return best + aspectWeight * Math.abs(Math.log(aspect / other.aspect));
        }
    }

    private static final class Template {
        final String text;
        final List<Shape> variants = new ArrayList<>();
        Template(String text, Rasterizer rasterizer, int width, int height, Map<String,List<Mask>> extraTemplates) {
            this.text = text;
            add(rasterizer.render(text, false), width, height);
            add(rasterizer.render(text, true), width, height);
            List<Mask> extra = extraTemplates.get(text);
            if (extra != null) for (Mask mask : extra) add(mask, width, height);
        }
        void add(Mask mask, int width, int height) {
            Shape shape = templateShape(mask, width, height);
            if (shape != null) variants.add(shape);
        }
        double distance(Shape target, double aspectWeight) {
            double best = Double.MAX_VALUE;
            for (Shape variant : variants) best = Math.min(best, target.distance(variant, aspectWeight));
            return best;
        }
    }

    private static final class Match {
        final String text;
        final Box box;
        final double score, margin;
        Match(String text, Box box, double score, double margin) {
            this.text = text; this.box = box; this.score = score; this.margin = margin;
        }
    }

    static List<Token> recognize(int width, int height, int[] argb, Rasterizer rasterizer) {
        return recognize(width, height, argb, rasterizer, Collections.emptyMap());
    }

    static List<Token> recognize(int width, int height, int[] argb, Rasterizer rasterizer, Map<String,List<Mask>> extraTemplates) {
        if (width < 160 || height < 64 || (long) width * height != argb.length) return Collections.emptyList();
        boolean[] ink = new boolean[argb.length];
        for (int i = 0; i < argb.length; i++) {
            int pixel = argb[i];
            int red = (pixel >> 16) & 255, green = (pixel >> 8) & 255, blue = pixel & 255;
            int max = Math.max(red, Math.max(green, blue)), min = Math.min(red, Math.min(green, blue));
            ink[i] = (pixel >>> 24) > 180 && max - min <= 46 && 3 * red + 6 * green + blue < 1530;
        }
        Mask image = new Mask(width, height, ink);
        List<Template> numerals = new ArrayList<>(), labels = new ArrayList<>();
        for (int i = 0; i < GLYPHS.length(); i++) {
            numerals.add(new Template(GLYPHS.substring(i, i + 1), rasterizer, 20, 30, extraTemplates));
        }
        for (String label : LABELS) labels.add(new Template(label, rasterizer, 56, 26, extraTemplates));

        List<Token> result = new ArrayList<>();
        int rightStart = width * 64 / 100, rightEnd = width * 96 / 100;
        int rowStart = -1, lastInk = -1;
        int gap = Math.max(1, width / 450);
        for (int y = 0; y <= height; y++) {
            int count = 0;
            if (y < height) for (int x = rightStart; x < rightEnd; x++) if (ink[y * width + x]) count++;
            if (count >= 2 && count < (rightEnd - rightStart) * .46) {
                if (rowStart < 0) rowStart = y;
                lastInk = y;
            } else if (rowStart >= 0 && (y - lastInk > gap || y == height)) {
                int rowHeight = lastInk + 1 - rowStart;
                if (rowHeight >= Math.max(9, width * .012) && rowHeight <= width * .071) {
                    Box band = new Box(rightStart, rowStart, rightEnd, lastInk + 1);
                    Match amount = readAmount(image, band, numerals);
                    if (amount != null) {
                        Match label = readLabel(image, amount.box, labels);
                        if (label != null) {
                            result.add(new Token(label.text, label.box));
                            result.add(new Token(amount.text, amount.box));
                        }
                    }
                }
                rowStart = -1;
            }
        }
        return result;
    }

    private static Match readAmount(Mask image, Box band, List<Template> templates) {
        List<Box> glyphs = columns(image, band);
        Match best = null;
        int start = 0;
        for (int end = 1; end <= glyphs.size(); end++) {
            if (end < glyphs.size() && glyphs.get(end).left - glyphs.get(end - 1).right <= band.height() * .49) continue;
            if (end - start >= 4 && end - start <= 18) {
                Match match = readAmountGroup(image, glyphs.subList(start, end), templates);
                if (match != null && (best == null || match.score < best.score)) best = match;
            }
            start = end;
        }
        return best;
    }

    static List<Token> recognizePayment(int width, int height, int[] argb, Rasterizer rasterizer,
            Map<String,List<Mask>> extraTemplates) {
        if (width < 160 || height < 64 || (long) width * height != argb.length) return Collections.emptyList();
        int left = width / 8, right = width - left, limit = height * 3 / 4;
        boolean[] ink = new boolean[width * limit];
        List<Template> numbers = new ArrayList<>(), merchants = new ArrayList<>();
        for (int i = 0; i < GLYPHS.length(); i++)
            numbers.add(new Template(GLYPHS.substring(i, i + 1), rasterizer, 20, 30, extraTemplates));
        for (String name : PAYMENT_MERCHANTS) merchants.add(new Template(name, rasterizer, 56, 26, extraTemplates));
        List<Token> amounts = new ArrayList<>(), names = new ArrayList<>();
        for (int y = 0; y < limit; y++) {
            for (int x = left; x < right; x++) {
                int pixel = argb[y * width + x];
                int red = (pixel >> 16) & 255, green = (pixel >> 8) & 255, blue = pixel & 255;
                int max = Math.max(red, Math.max(green, blue)), min = Math.min(red, Math.min(green, blue));
                ink[y * width + x] = (pixel >>> 24) > 180 && max - min <= 46 && 3 * red + 6 * green + blue < 1530;
            }
        }
        Mask image = new Mask(width, limit, ink);
        int start = -1;
        for (int y = height / 14; y <= limit; y++) {
            int count = 0;
            if (y < limit) for (int x = left; x < right; x++) if (ink[y * width + x]) count++;
            if (count >= 2 && count < (right - left) * .72) {
                if (start < 0) start = y;
                continue;
            }
            if (start < 0) continue;
            int h = y - start;
            if (h >= Math.max(9, width / 70) && h <= width / 7) {
                Box box = trim(image, new Box(left, start, right, y));
                if (box != null && Math.abs((box.left + box.right) / 2 - width / 2) <= width / 8) {
                    Match amount = readAmount(image, box, numbers);
                    if (amount != null && amount.text.startsWith("¥") && amount.score < .20) {
                        amounts.add(new Token(amount.text, amount.box));
                    } else if (box.width() >= h * 1.6 && box.width() <= h * 6) {
                        Match name = nearest(image, box, merchants, 56, 26, .24);
                        if (name != null && name.score < .16 && name.margin > .06)
                            names.add(new Token("商户：" + name.text, box));
                    }
                }
            }
            start = -1;
        }
        if (amounts.size() == 1) {
            Token amount = amounts.get(0), merchant = null;
            for (Token name : names) {
                if (name.top <= amount.bottom + width / 8 && name.bottom >= amount.top - width / 5) {
                    if (merchant != null) return amounts;
                    merchant = name;
                }
            }
            if (merchant != null) amounts.add(merchant);
        }
        return amounts;
    }

    private static Match readAmountGroup(Mask image, List<Box> group, List<Template> templates) {
        int height = 0, top = Integer.MAX_VALUE, bottom = 0;
        for (Box glyph : group) {
            height = Math.max(height, glyph.height());
            top = Math.min(top, glyph.top);
            bottom = Math.max(bottom, glyph.bottom);
        }
        int digitBaseline = 0;
        for (Box glyph : group) if (glyph.height() >= height * .70) digitBaseline = Math.max(digitBaseline, glyph.bottom);
        StringBuilder text = new StringBuilder();
        double score = 0, margin = 1;
        int counted = 0, used = group.size();
        for (int i = 0; i < group.size(); i++) {
            Box glyph = group.get(i);
            if (glyph.height() <= height * .46) {
                if (glyph.bottom >= digitBaseline - height * .19 && glyph.width() <= height * .34) {
                    // Small decimal points can be tall rectangles in UI fonts. Resolve
                    // grouping separators only after locating the final two decimals.
                    text.append('.');
                } else if (i <= 1 && glyph.width() >= height * .18 && glyph.width() >= glyph.height() * 1.5) {
                    text.append('-');
                } else return null;
                continue;
            }
            if (glyph.width() > height * .9) return null;
            Match match = nearest(image, glyph, templates, 20, 30, .14);
            if (match == null || match.score > .25 || match.margin < .012) return null;
            if (match.text.equals("›") || match.text.equals(">")) {
                if (i != group.size() - 1) return null;
                used--;
            } else {
                if (glyph.height() < height * .70) return null;
                text.append(match.text);
                score += match.score;
                margin = Math.min(margin, match.margin);
                counted++;
            }
        }
        int finalSeparator = text.lastIndexOf(".");
        for (int i = 0; i < finalSeparator; i++) if (text.charAt(i) == '.') text.setCharAt(i, ',');
        if (counted < 3 || !AMOUNT.matcher(text).matches()) return null;
        return new Match(text.toString(), new Box(group.get(0).left, top, group.get(used - 1).right, bottom), score / counted, margin);
    }

    private static Match readLabel(Mask image, Box amount, List<Template> templates) {
        int height = amount.height();
        Box left = new Box(image.width / 10, Math.max(0, amount.top - height),
            image.width * 56 / 100, Math.min(image.height, amount.bottom + height / 3));
        List<Box> strokes = columns(image, left);
        Match best = null;
        int start = 0;
        for (int end = 1; end <= strokes.size(); end++) {
            if (end < strokes.size() && strokes.get(end).left - strokes.get(end - 1).right <= height * .31) continue;
            Box cluster = trim(image, new Box(strokes.get(start).left, left.top, strokes.get(end - 1).right, left.bottom));
            if (cluster != null && cluster.height() >= height * .55 && cluster.height() <= height * 1.58
                && cluster.width() >= cluster.height() * 1.45 && cluster.width() <= cluster.height() * 6.3) {
                Match match = nearest(image, cluster, templates, 56, 26, .23);
                if (match != null && match.score <= .23 && match.margin >= .036
                    && (best == null || match.score < best.score)) best = match;
            }
            start = end;
        }
        return best;
    }

    private static Shape templateShape(Mask mask, int width, int height) {
        if (mask == null) return null;
        Box box = trim(mask, new Box(0, 0, mask.width, mask.height));
        return box == null ? null : new Shape(mask, box, width, height);
    }

    private static Match nearest(Mask image, Box box, List<Template> templates, int width, int height, double aspectWeight) {
        Shape shape = new Shape(image, box, width, height);
        String text = null;
        double best = Double.MAX_VALUE, next = Double.MAX_VALUE;
        for (Template template : templates) {
            double score = template.distance(shape, aspectWeight);
            if (score < best) { next = best; best = score; text = template.text; }
            else if (score < next) next = score;
        }
        return text == null ? null : new Match(text, box, best, next - best);
    }

    private static List<Box> columns(Mask image, Box bounds) {
        List<Box> parts = new ArrayList<>();
        int start = -1;
        for (int x = bounds.left; x <= bounds.right; x++) {
            boolean occupied = false;
            if (x < bounds.right) for (int y = bounds.top; y < bounds.bottom; y++) {
                if (image.ink[y * image.width + x]) { occupied = true; break; }
            }
            if (occupied) { if (start < 0) start = x; }
            else if (start >= 0) {
                Box part = trim(image, new Box(start, bounds.top, x, bounds.bottom));
                if (part != null && part.width() * part.height() >= 4) parts.add(part);
                start = -1;
            }
        }
        return parts;
    }

    private static Box trim(Mask image, Box bounds) {
        int left = bounds.right, right = bounds.left - 1, top = bounds.bottom, bottom = bounds.top - 1;
        for (int y = bounds.top; y < bounds.bottom; y++) for (int x = bounds.left; x < bounds.right; x++) {
            if (!image.ink[y * image.width + x]) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return left > right ? null : new Box(left, top, right + 1, bottom + 1);
    }
}
