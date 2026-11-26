# 余量 Android v3.3.6

网页资源位于 `android/www`。Android Gradle 工程位于 `android/android`，构建时将网页资源打包到 APK 的 `assets/www`。

从 Windows v3.1.15 源码工程重新生成网页资源时，先运行 Windows 工程的 `node prepare.cjs`，再从本目录运行 `node prepare.cjs "<Windows v3.1.15 工程的 build 目录>"`。

使用 JDK 17、Gradle 8.11.1 和 Android SDK 36，在 `android/android` 中运行 `gradle :app:assembleRelease`。安装包需使用历史发布签名才能覆盖安装旧版。已发布的同版本 APK 与此分支源码分别维护。
