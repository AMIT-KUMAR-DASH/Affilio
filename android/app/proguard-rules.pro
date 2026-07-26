# Add project specific ProGuard rules here.
# Keep Capacitor plugin bridge classes.
-keep class com.getcapacitor.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
