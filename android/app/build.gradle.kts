plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The same version as the web and iPhone apps (VERSION at the repository root); the build number counts
// commits, so every build is newer than the last.
val repoRoot = rootDir.parentFile
val appVersion = repoRoot.resolve("VERSION").takeIf { it.exists() }?.readText()?.trim() ?: "0.0.0"
val buildNumber = providers.exec { commandLine("git", "rev-list", "--count", "HEAD"); isIgnoreExitValue = true }
    .standardOutput.asText.get().trim().toIntOrNull() ?: 1

// Release signing, from the environment (GitHub secrets) when there is a key; otherwise debug-signed.
val keystoreFile = System.getenv("ANDROID_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }

android {
    namespace = "com.bradcowdrey.goldenhour"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bradcowdrey.goldenhour"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = appVersion
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
