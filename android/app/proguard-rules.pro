# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.codexnovel.reader.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.codexnovel.reader.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
