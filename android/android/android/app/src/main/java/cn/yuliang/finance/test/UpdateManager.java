package cn.yuliang.finance.test;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

final class UpdateManager {
    static final String CURRENT_VERSION = "3.3.6";
    static final long MAX_APK_BYTES = 200L * 1024L * 1024L;
    private static final String REPOSITORY = "huiyan007/yuliang-releases";
    private static final String RELEASE_PAGE = "https://github.com/" + REPOSITORY + "/releases";
    private static final String API_RELEASES = "https://api.github.com/repos/" + REPOSITORY + "/releases";
    private static final int RELEASE_PAGE_SIZE = 30;

    private final Activity activity;
    private final SharedPreferences prefs;
    private final ExecutorService downloadWorker = Executors.newSingleThreadExecutor();
    private final Object gate = new Object();
    private Asset asset;
    private String packageStatus = "idle";
    private String packageMessage = "";
    private long received;
    private long total;

    UpdateManager(Activity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences("updates-v1", Activity.MODE_PRIVATE);
        restorePackage();
    }

    void close() { downloadWorker.shutdownNow(); }

    JSONObject check() {
        try {
            JSONObject selected = null;
            String selectedVersion = null;
            for (int page = 1; ; page++) {
                HttpResult result = request(API_RELEASES + "?per_page=" + RELEASE_PAGE_SIZE + "&page=" + page,
                    "application/vnd.github+json", 2 * 1024 * 1024);
                JSONObject failure = transportFailure(result);
                if (failure != null) return failure;
                JSONArray releases = new JSONArray(result.body);
                for (int i = 0; i < releases.length(); i++) {
                    JSONObject release = releases.optJSONObject(i);
                    if (release == null || release.optBoolean("draft") || release.optBoolean("prerelease")) continue;
                    String tag = release.optString("tag_name", "").trim();
                    String version = UpdatePolicy.releaseVersion(tag);
                    if (version == null) continue;
                    JSONObject apk = findAsset(release, "yuliang-android-v" + version + ".apk");
                    if (UpdatePolicy.isNewerAndroidRelease(tag, apk != null, selectedVersion)) {
                        selected = release;
                        selectedVersion = version;
                    }
                }
                if (releases.length() < RELEASE_PAGE_SIZE) break;
            }
            if (selected == null) return status("no_release", "GitHub 上暂无可用的 Android 发布版。");
            if (UpdatePolicy.compareVersions(selectedVersion, CURRENT_VERSION) <= 0) return status("current", "");
            return checkAndroidAsset(selected, selectedVersion);
        } catch (SocketTimeoutException error) {
            return status("network_failed", "GitHub 请求超时，请稍后重试。");
        } catch (IOException error) {
            return status("network_failed", "无法访问 GitHub：" + safeMessage(error));
        } catch (Exception error) {
            return status("invalid", safeMessage(error));
        }
    }

    private static JSONObject findAsset(JSONObject release, String name) {
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject item = assets.optJSONObject(i);
            if (item != null && name.equalsIgnoreCase(item.optString("name", ""))) return item;
        }
        return null;
    }

    private JSONObject checkAndroidAsset(JSONObject release, String version) throws Exception {
        String tag = release.optString("tag_name", "").trim();
        String notes = release.optString("body", "");
        String apkName = "yuliang-android-v" + version + ".apk";
        JSONObject apk = findAsset(release, apkName);
        JSONObject checksum = findAsset(release, apkName + ".sha256");
        if (checksum == null) checksum = findAsset(release, "yuliang-android-v" + version + ".sha256");
        String url = apk.optString("browser_download_url", "");
        long size = apk.optLong("size", -1);
        if (!validAssetUrl(url, tag, apkName) || size <= 0 || size > MAX_APK_BYTES) {
            return versionStatus("unverified", version, notes);
        }
        String digest = apk.optString("digest", "");
        if (digest.toLowerCase(Locale.ROOT).startsWith("sha256:")) digest = digest.substring(7);
        if (!UpdatePolicy.validSha256(digest) && checksum != null &&
            validAssetUrl(checksum.optString("browser_download_url", ""), tag, checksum.optString("name"))) {
            HttpResult checksumResult = request(checksum.optString("browser_download_url", ""), "text/plain", 4096);
            JSONObject checksumFailure = transportFailure(checksumResult);
            if (checksumFailure != null) return checksumFailure;
            java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(?i)\\b[0-9a-f]{64}\\b").matcher(checksumResult.body);
            if (matcher.find()) digest = matcher.group();
        }
        if (!UpdatePolicy.validSha256(digest)) {
            return versionStatus("unverified", version, notes);
        }
        return available(new Asset(version, url, size, digest.toUpperCase(Locale.ROOT)), notes);
    }

    private JSONObject available(Asset next, String notes) throws Exception {
        synchronized (gate) {
            asset = next;
            if (!("ready".equals(packageStatus) && next.version.equals(prefs.getString("version", "")))) {
                packageStatus = "idle";
                packageMessage = "";
                received = 0;
                total = next.size;
            }
            return new JSONObject().put("status", "available").put("version", next.version)
                .put("notes", notes).put("package", packageJson());
        }
    }

    JSONObject startDownload(String version) throws Exception {
        synchronized (gate) {
            if (asset == null || !asset.version.equals(version)) throw new Exception("请重新检查更新。");
            if ("downloading".equals(packageStatus)) return packageJson();
            if ("ready".equals(packageStatus) && UpdateFileProvider.updateFile(activity).isFile()) return packageJson();
            packageStatus = "downloading";
            packageMessage = "";
            received = 0;
            total = asset.size;
            final Asset downloadAsset = asset;
            downloadWorker.execute(() -> download(downloadAsset));
            return packageJson();
        }
    }

    JSONObject packageStatus() throws Exception { synchronized (gate) { return packageJson(); } }

    JSONObject install(String version) throws Exception {
        Asset installing;
        synchronized (gate) {
            if (asset == null || !asset.version.equals(version) || !"ready".equals(packageStatus)) {
                throw new Exception("安装包尚未准备好，请重新检查并下载。");
            }
            installing = asset;
        }
        File file = UpdateFileProvider.updateFile(activity);
        if (!file.isFile() || file.length() != installing.size || !sha256(file).equalsIgnoreCase(installing.sha256)) {
            synchronized (gate) { packageStatus = "failed"; packageMessage = "安装包校验失败，请重新下载。"; }
            throw new Exception(packageMessage);
        }
        boolean allowed = activity.getPackageManager().canRequestPackageInstalls();
        if ("permission_required".equals(UpdatePolicy.installDecision(true, allowed))) {
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(intent);
            });
            throw new Exception("请允许余量安装未知应用，返回后再点击“重启并安装”。");
        }
        activity.runOnUiThread(() -> {
            Uri uri = Uri.parse("content://" + UpdateFileProvider.AUTHORITY + "/" + UpdateFileProvider.PATH);
            Intent intent = new Intent(Intent.ACTION_VIEW, uri)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        });
        return new JSONObject().put("status", "ok").put("message", "已打开系统安装器。")
            .put("package", new JSONObject().put("status", "ready").put("message", "已打开系统安装器；取消安装后可再次尝试。"));
    }

    JSONObject openReleasePage() throws Exception {
        activity.runOnUiThread(() -> activity.startActivity(new Intent(Intent.ACTION_VIEW,
            Uri.parse(RELEASE_PAGE))));
        return new JSONObject().put("status", "ok");
    }

    private void download(Asset downloading) {
        File finalFile = UpdateFileProvider.updateFile(activity);
        File directory = finalFile.getParentFile();
        File temporary = new File(directory, "update.part");
        try {
            if (!directory.exists() && !directory.mkdirs()) throw new IOException("无法创建更新目录。");
            if (temporary.exists() && !temporary.delete()) throw new IOException("无法清理旧的下载文件。");
            HttpURLConnection connection = openDownload(downloading.url);
            try {
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new IOException("APK 下载失败（HTTP " + code + "）。");
                long contentLength = connection.getContentLengthLong();
                if (contentLength > 0 && contentLength != downloading.size) throw new IOException("APK 大小与发布信息不一致。");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[64 * 1024];
                    long count = 0;
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        if (read == 0) continue;
                        count += read;
                        if (count > downloading.size || count > MAX_APK_BYTES) throw new IOException("APK 超出预期大小。");
                        output.write(buffer, 0, read);
                        synchronized (gate) { received = count; }
                    }
                    output.getFD().sync();
                }
            } finally { connection.disconnect(); }
            if (temporary.length() != downloading.size) throw new IOException("APK 下载不完整。");
            if (!sha256(temporary).equalsIgnoreCase(downloading.sha256)) throw new IOException("APK SHA-256 校验失败。");
            if (finalFile.exists() && !finalFile.delete()) throw new IOException("无法替换旧的安装包。");
            if (!temporary.renameTo(finalFile)) throw new IOException("无法保存已校验的安装包。");
            prefs.edit().putString("version", downloading.version).putString("url", downloading.url)
                .putString("sha256", downloading.sha256).putLong("size", downloading.size).commit();
            synchronized (gate) {
                received = downloading.size;
                total = downloading.size;
                packageStatus = "ready";
                packageMessage = "APK 已通过大小和 SHA-256 校验。";
            }
        } catch (Exception error) {
            temporary.delete();
            synchronized (gate) {
                packageStatus = "failed";
                packageMessage = safeMessage(error);
            }
        }
    }

    private void restorePackage() {
        File file = UpdateFileProvider.updateFile(activity);
        String version = prefs.getString("version", "");
        long size = prefs.getLong("size", -1);
        String sha = prefs.getString("sha256", "");
        String restored = UpdatePolicy.restoredPackageStatus(CURRENT_VERSION, version, file.isFile(), size,
            file.isFile() ? file.length() : -1, sha);
        if ("ready".equals(restored)) {
            asset = new Asset(version, prefs.getString("url", ""), size, sha);
            packageStatus = "ready";
            packageMessage = "已恢复上次下载并校验的 APK。";
            received = total = size;
        } else {
            prefs.edit().clear().apply();
            if (file.exists()) file.delete();
        }
    }

    private JSONObject packageJson() throws Exception {
        return new JSONObject().put("status", packageStatus).put("version", asset == null ? "" : asset.version)
            .put("received", received).put("total", total).put("message", packageMessage);
    }

    private JSONObject status(String value, String message) {
        try { return new JSONObject().put("status", value).put("message", message); }
        catch (Exception impossible) { return new JSONObject(); }
    }

    private JSONObject versionStatus(String value, String version, String notes) {
        try { return new JSONObject().put("status", value).put("version", version).put("notes", notes); }
        catch (Exception impossible) { return new JSONObject(); }
    }

    private JSONObject transportFailure(HttpResult result) {
        String classification = UpdatePolicy.classifyHttp(result.code, result.rateRemaining);
        if ("ok".equals(classification)) return null;
        if ("rate_limited".equals(classification)) return status(classification, "请稍后重试或直接打开发布页。");
        if ("no_release".equals(classification)) return status(classification, "GitHub 上暂无可用发布版。");
        if ("network_failed".equals(classification)) return status(classification, "GitHub 服务暂时不可用。");
        return status("failed", "GitHub 返回 HTTP " + result.code + "。");
    }

    private HttpResult request(String url, String accept, int maxBytes) throws IOException {
        IOException last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try { return requestOnce(url, accept, maxBytes); }
            catch (SocketTimeoutException error) { last = error; }
            catch (IOException error) { last = error; }
            if (attempt == 0) try { Thread.sleep(300); } catch (InterruptedException error) {
                Thread.currentThread().interrupt(); throw new IOException("更新检查已取消。", error);
            }
        }
        throw last == null ? new IOException("网络请求失败。") : last;
    }

    private HttpResult requestOnce(String rawUrl, String accept, int maxBytes) throws IOException {
        URL url = new URL(rawUrl);
        for (int redirect = 0; redirect < 5; redirect++) {
            validateHttpsHost(url);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("User-Agent", "Yuliang-Android/" + CURRENT_VERSION);
            connection.setRequestProperty("Accept", accept);
            int code = connection.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) throw new IOException("GitHub 重定向地址为空。");
                url = new URL(url, location);
                continue;
            }
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = stream == null ? "" : readText(stream, maxBytes);
            String remaining = connection.getHeaderField("X-RateLimit-Remaining");
            connection.disconnect();
            return new HttpResult(code, body, remaining == null ? "" : remaining);
        }
        throw new IOException("GitHub 重定向次数过多。");
    }

    private HttpURLConnection openDownload(String rawUrl) throws IOException {
        URL url = new URL(rawUrl);
        for (int redirect = 0; redirect < 5; redirect++) {
            validateHttpsHost(url);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "Yuliang-Android/" + CURRENT_VERSION);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            int code = connection.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) throw new IOException("APK 重定向地址为空。");
                url = new URL(url, location);
                continue;
            }
            return connection;
        }
        throw new IOException("APK 重定向次数过多。");
    }

    private static void validateHttpsHost(URL url) throws IOException {
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getPort() != -1 ||
            !("github.com".equals(host) || "api.github.com".equals(host) ||
              "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host))) {
            throw new IOException("GitHub 发布地址无效。");
        }
    }

    private static boolean validAssetUrl(String value, String tag, String name) {
        try {
            URI uri = new URI(value);
            String expected = "/" + REPOSITORY + "/releases/download/" + tag + "/" + name;
            return "https".equalsIgnoreCase(uri.getScheme()) && "github.com".equalsIgnoreCase(uri.getHost()) &&
                uri.getPort() == -1 && uri.getUserInfo() == null && uri.getQuery() == null &&
                uri.getFragment() == null && expected.equalsIgnoreCase(uri.getPath());
        } catch (Exception error) { return false; }
    }

    private static String readText(InputStream input, int maxBytes) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) >= 0) {
                if (read == 0) continue;
                total += read;
                if (total > maxBytes) throw new IOException("GitHub 响应过大。");
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8).replace("\uFEFF", "");
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) if (read > 0) digest.update(buffer, 0, read);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.ROOT, "%02X", item));
        return value.toString();
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "未知错误。" : message;
    }

    private static final class Asset {
        final String version;
        final String url;
        final long size;
        final String sha256;
        Asset(String version, String url, long size, String sha256) {
            this.version = version; this.url = url; this.size = size; this.sha256 = sha256;
        }
    }

    private static final class HttpResult {
        final int code;
        final String body;
        final String rateRemaining;
        HttpResult(int code, String body, String rateRemaining) {
            this.code = code; this.body = body; this.rateRemaining = rateRemaining;
        }
    }
}
