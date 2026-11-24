const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(rootDir, 'node_modules');

function patchFile(filePath, transforms) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [pattern, replacement] of transforms) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Patched:', filePath);
  }
}

// 1. Patch react-native flow component specs that use Readonly instead of $ReadOnly
function patchReactNativePrivate(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      patchReactNativePrivate(full);
    } else if (item.isFile() && item.name.endsWith('.js')) {
      patchFile(full, [
        [/\bReadonly<\{/g, '$ReadOnly<{'],
        [/\bReadonlyArray</g, '$ReadOnlyArray<']
      ]);
    }
  }
}

patchReactNativePrivate(path.join(nodeModulesDir, 'react-native/src/private'));

// 2. Patch react-native-screens ComponentRef in fabric codegen spec
const rnsSpec = path.join(nodeModulesDir, 'react-native-screens/src/fabric/gamma/stack/StackHeaderConfigAndroidNativeComponent.ts');
patchFile(rnsSpec, [
  [/React\.ComponentRef</g, 'React.ElementRef<']
]);

// 3. Patch expo-notifications warnOfExpoGoPushUsage so it warns instead of throwing on Android Expo Go
const notifWarnJs = path.join(nodeModulesDir, 'expo-notifications/build/warnOfExpoGoPushUsage.js');
patchFile(notifWarnJs, [
  [/if\s*\(Platform\.OS === 'android'\)\s*\{\s*throw new Error\(message\);\s*\}\s*else if\s*\(__DEV__\)\s*\{\s*didWarn = true;\s*console\.warn\(message\);\s*\}/g, 'didWarn = true;\n            console.warn(message);']
]);
const notifWarnTs = path.join(nodeModulesDir, 'expo-notifications/src/warnOfExpoGoPushUsage.ts');
patchFile(notifWarnTs, [
  [/if\s*\(Platform\.OS === 'android'\)\s*\{\s*throw new Error\(message\);\s*\}\s*else if\s*\(__DEV__\)\s*\{\s*didWarn = true;\s*console\.warn\(message\);\s*\}/g, 'didWarn = true;\n      console.warn(message);']
]);

// 3b. Patch expo-notifications TopicSubscriptionModule so importing the package doesn't crash in Android Expo Go
// (Expo Go ships without ExpoTopicSubscriptionModule; topicSubscription.js already guards against missing methods)
const topicModJs = path.join(nodeModulesDir, 'expo-notifications/build/TopicSubscriptionModule.android.js');
patchFile(topicModJs, [
  [/import \{ requireNativeModule \} from 'expo-modules-core';/, "import { requireOptionalNativeModule } from 'expo-modules-core';"],
  [/export default requireNativeModule\('ExpoTopicSubscriptionModule'\);/, "export default requireOptionalNativeModule('ExpoTopicSubscriptionModule') ?? {};"]
]);
const topicModTs = path.join(nodeModulesDir, 'expo-notifications/src/TopicSubscriptionModule.android.ts');
patchFile(topicModTs, [
  [/import \{ requireNativeModule \} from 'expo-modules-core';/, "import { requireOptionalNativeModule } from 'expo-modules-core';"],
  [/export default requireNativeModule<TopicSubscriptionModule>\('ExpoTopicSubscriptionModule'\);/, "export default requireOptionalNativeModule<TopicSubscriptionModule>('ExpoTopicSubscriptionModule') ?? ({} as TopicSubscriptionModule);"]
]);

// 4. Patch all codegen flow and typescript parser files
function walkAndPatchCodegen(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory() && item.name !== '.git') {
      walkAndPatchCodegen(full);
    } else if (item.isFile() && item.name.endsWith('.js') && full.includes('codegen')) {
      patchFile(full, [
        [/name === '\$ReadOnly'(?! \|\| name === 'Readonly')/g, "name === '$ReadOnly' || name === 'Readonly'"],
        [/objectType\.id\.name === '\$ReadOnly'(?! \|\|)/g, "(objectType.id.name === '$ReadOnly' || objectType.id.name === 'Readonly')"],
        [/objectType\.id\.name === '\$ReadOnlyArray'(?! \|\|)/g, "(objectType.id.name === '$ReadOnlyArray' || objectType.id.name === 'ReadonlyArray')"],
        [/=== '\$ReadOnlyArray'(?! \|\|)/g, "=== '$ReadOnlyArray' || parser.getTypeAnnotationName(typeAnnotation) === 'ReadonlyArray'"],
        [/=== '\$ReadOnly'(?! \|\|)/g, "=== '$ReadOnly' || parser.getTypeAnnotationName(typeAnnotation) === 'Readonly'"],
        [/=== 'ElementRef'(?! \|\|)/g, "=== 'ElementRef' || _firstParam$typeAnnot2.name === 'ComponentRef'"]
      ]);
    }
  }
}

walkAndPatchCodegen(nodeModulesDir);
console.log('Codegen and React Native patching complete.');
