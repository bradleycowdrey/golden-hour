import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The same version as the web and iPhone apps (VERSION at the repository root). The version code is the
// number of commits in the history (`git rev-list --count HEAD`, the iPhone app's build number too), so every
// new commit on main gives a higher code and each build for Google Play is newer than the last. It needs the
// full history: .github/workflows/android.yml checks out with fetch-depth 0 and refuses a shallow clone.
val repoRoot = rootDir.parentFile
val appVersion = repoRoot.resolve("VERSION").readText().trim()
val commitCount = providers.exec {
    commandLine("git", "-C", repoRoot.path, "rev-list", "--count", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.get().trim().toIntOrNull() ?: 1

// Release signing with the upload key, from the environment: the workflow decodes the ANDROID_KEYSTORE_B64
// secret to a file and passes its path. No key in the repository. Without it the release build is unsigned
// (and the workflow doesn't build it or send anything to Google Play).
val keystoreFile = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }?.let(::file)?.takeIf { it.exists() }
val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD").orEmpty()

android {
    namespace = "com.bradcowdrey.goldenhour"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bradcowdrey.goldenhour"
        minSdk = 26
        targetSdk = 36
        versionCode = commitCount
        versionName = appVersion
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = keystorePassword
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")?.takeIf { it.isNotEmpty() } ?: keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    // The page's messages (share, calendar, bar colours), accepted only from the Golden Hour site.
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
}
