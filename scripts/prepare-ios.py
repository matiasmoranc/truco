"""Configure the freshly generated Capacitor project on the Codemagic Mac."""
import base64
import os
import plistlib
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
info["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
info["UISupportedInterfaceOrientations~ipad"] = ["UIInterfaceOrientationPortrait"]
info_path.write_bytes(plistlib.dumps(info))
(app / "App.entitlements").write_bytes(plistlib.dumps({"com.apple.developer.applesignin": ["Default"]}))

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
project_path.write_text(project)
print("iOS configurado: Firebase, acceso Google y capacidad Sign in with Apple.")
