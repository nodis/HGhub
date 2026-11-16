import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Persist the release fix outside gen/: safe to rerun after every android init.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const main = join(root, "src-tauri/gen/android/app/src/main");
const manifest = join(main, "AndroidManifest.xml");
if (existsSync(manifest)) {
  const java = join(main, "java/com/hghub/player");
  mkdirSync(java, { recursive: true });
  copyFileSync(join(root, "src-tauri/android/OrientationPlugin.kt"), join(java, "OrientationPlugin.kt"));
  mkdirSync(join(main, "res/xml"), { recursive: true });
  copyFileSync(join(root, "src-tauri/android/network_security_config.xml"), join(main, "res/xml/network_security_config.xml"));
  let xml = readFileSync(manifest, "utf8");
  if (/android:networkSecurityConfig=/.test(xml)) xml = xml.replace(/android:networkSecurityConfig="[^"]*"/, 'android:networkSecurityConfig="@xml/network_security_config"');
  else xml = xml.replace(/<application\b/, '<application android:networkSecurityConfig="@xml/network_security_config"');
  writeFileSync(manifest, xml);
  console.log("[android] 已同步应用内媒体回环网络配置");
}
