package cn.yuliang.finance.test;

import java.math.BigInteger;

final class UpdatePolicy {
    private UpdatePolicy() {}

    static int compareVersions(String left, String right) {
        BigInteger[] a = parseVersion(left);
        BigInteger[] b = parseVersion(right);
        for (int i = 0; i < 3; i++) {
            int result = a[i].compareTo(b[i]);
            if (result != 0) return result;
        }
        return 0;
    }

    static BigInteger[] parseVersion(String value) {
        if (value == null || !value.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) {
            throw new IllegalArgumentException("版本号不符合语义版本规则。");
        }
        String[] parts = value.split("\\.");
        return new BigInteger[] {
            new BigInteger(parts[0]), new BigInteger(parts[1]), new BigInteger(parts[2])
        };
    }

    static boolean validSha256(String value) {
        return value != null && value.matches("(?i)[0-9a-f]{64}");
    }

    static String releaseVersion(String tag) {
        if (tag == null || !tag.matches("(?:android-v|v)?[0-9]+\\.[0-9]+\\.[0-9]+")) return null;
        return tag.replaceFirst("^(android-v|v)", "");
    }

    static boolean isNewerAndroidRelease(String tag, boolean hasApk, String selectedVersion) {
        String version = releaseVersion(tag);
        return version != null && hasApk &&
            (selectedVersion == null || compareVersions(version, selectedVersion) > 0);
    }

    static String classifyHttp(int code, String rateRemaining) {
        if ((code == 403 || code == 429) && ("0".equals(rateRemaining) || code == 429)) {
            return "rate_limited";
        }
        if (code == 404) return "no_release";
        if (code >= 500) return "network_failed";
        return code >= 200 && code < 300 ? "ok" : "failed";
    }

    static String installDecision(boolean ready, boolean canRequestInstalls) {
        if (!ready) return "not_ready";
        return canRequestInstalls ? "install" : "permission_required";
    }

    static String restoredPackageStatus(String currentVersion, String storedVersion,
                                        boolean fileExists, long expectedSize, long actualSize,
                                        String sha256) {
        if (!fileExists || expectedSize <= 0 || actualSize != expectedSize || !validSha256(sha256)) {
            return "idle";
        }
        try {
            return compareVersions(storedVersion, currentVersion) > 0 ? "ready" : "idle";
        } catch (IllegalArgumentException error) {
            return "idle";
        }
    }
}
