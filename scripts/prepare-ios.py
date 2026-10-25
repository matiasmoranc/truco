"""Configure the freshly generated Capacitor project on the Codemagic Mac."""
import base64
import os
import json
import plistlib
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
app = root / "ios/App/App"
encoded = os.environ.get("GOOGLE_SERVICE_INFO_PLIST_BASE64", "")
if not encoded:
    raise SystemExit("Falta GOOGLE_SERVICE_INFO_PLIST_BASE64 en el grupo truco_ios de Codemagic.")
firebase = plistlib.loads(base64.b64decode(encoded, validate=True))
if firebase.get("BUNDLE_ID") != "com.matiasmoranc.truco":
    raise SystemExit("El plist de Firebase debe ser para com.matiasmoranc.truco.")
if firebase.get("PROJECT_ID") != "truco-6553d" or not firebase.get("REVERSED_CLIENT_ID"):
    raise SystemExit("Usa el plist del proyecto truco-6553d con Google habilitado.")
(app / "GoogleService-Info.plist").write_bytes(plistlib.dumps(firebase))

info_path = app / "Info.plist"
info = plistlib.loads(info_path.read_bytes())
info["CFBundleURLTypes"] = [{"CFBundleURLSchemes": [firebase["REVERSED_CLIENT_ID"]]}]
# Use a unique increasing number for each build of this Codemagic application.
info["CFBundleVersion"] = str(int(os.environ.get("PROJECT_BUILD_NUMBER", "1")))
info["CFBundleShortVersionString"] = "1.0.0"
# Only standard platform/provider encryption is used; no proprietary encryption.
info["ITSAppUsesNonExemptEncryption"] = False
# Remove legacy advertising metadata when regenerating an existing project.
for key in ["GADApplicationIdentifier", "SKAdNetworkItems", "NSUserTrackingUsageDescription"]:
    info.pop(key, None)
# Table invitations arrive as push notifications (Firebase Cloud Messaging over APNs).
info["UIBackgroundModes"] = ["remote-notification"]
info["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
# The first App Store release is iPhone only (portrait); iPad comes in a later version.
info.pop("UISupportedInterfaceOrientations~ipad", None)
info_path.write_bytes(plistlib.dumps(info))
(app / "App.entitlements").write_bytes(plistlib.dumps({"com.apple.developer.applesignin": ["Default"], "aps-environment": "production"}))

# The messaging plugin needs the APNs device token forwarded from the app delegate.
delegate_path = app / "AppDelegate.swift"
delegate = delegate_path.read_text()
if "capacitorDidRegisterForRemoteNotifications" not in delegate:
    hooks = """
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name.init("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }
"""
    end = delegate.rstrip().rfind("}")
    if end < 0:
        raise SystemExit("No se encontro AppDelegate.swift para las notificaciones.")
    delegate = delegate[:end] + hooks + "}\n"
    delegate_path.write_text(delegate)

# Capacitor's generated project is not committed. Attach the Firebase plist
# explicitly to its App resource phase, rather than merely copying a file.
project_path = root / "ios/App/App.xcodeproj/project.pbxproj"
project = project_path.read_text()
resource_id = "F1A000000000000000000001"
build_id = "F1A000000000000000000002"
if resource_id not in project:
    replacements = {
        "/* Begin PBXBuildFile section */": f"/* Begin PBXBuildFile section */\n\t\t{build_id} = {{isa = PBXBuildFile; fileRef = {resource_id}; }};",
        "/* Begin PBXFileReference section */": f'/* Begin PBXFileReference section */\n\t\t{resource_id} = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; }};',
        "504EC3061FED79650016851F /* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (": "504EC3061FED79650016851F /* App */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t" + resource_id + ",",
        "isa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (": "isa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t" + build_id + ",",
    }
    for marker, replacement in replacements.items():
        if project.count(marker) != 1:
            raise SystemExit("Cambio el formato del proyecto iOS; revisar prepare-ios.py antes de compilar.")
        project = project.replace(marker, replacement)
if "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;" not in project:
    project = project.replace("INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;")
# iPhone only: no iPad build, screenshots or iPad review for this release.
project, families = re.subn(r"TARGETED_DEVICE_FAMILY = [^;]+;", "TARGETED_DEVICE_FAMILY = 1;", project)
if not families:
    project = project.replace("INFOPLIST_FILE = App/Info.plist;", "INFOPLIST_FILE = App/Info.plist;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;")
project_path.write_text(project)
print("iOS configurado: Firebase, acceso Google, Sign in with Apple, notificaciones y solo iPhone.")
