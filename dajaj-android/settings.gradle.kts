pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "DajajPOS"

include(":app")
include(":feature-pos")
include(":feature-pending-orders")
include(":feature-kitchen")
include(":feature-reports")
include(":feature-settings")
include(":core-domain")
include(":core-data")
include(":core-bluetooth")
include(":core-print-agent")
include(":core-ui")
include(":core-common")
