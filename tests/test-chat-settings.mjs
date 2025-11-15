/**
 * Chat Settings System Test
 */

import { loadChatSettings, saveChatSettings, applyPreset, getChatSettingsConfig, getChatSettingsScope } from '../packages/core/src/chat-settings.js';

console.log('🧪 Testing Chat Settings System\n');

// Test 1: Load settings
console.log('Test 1: Load default settings');
try {
  const settings = loadChatSettings();
  console.log('✅ Settings loaded:', {
    contextInfluence: settings.contextInfluence,
    temperature: settings.temperature,
    maxContextChars: settings.maxContextChars,
    userInputPriority: settings.userInputPriority
  });
} catch (error) {
  console.log('❌ FAILED to load settings:', error.message);
}

// Test 2: Get configuration
console.log('\nTest 2: Get full configuration');
try {
  const config = getChatSettingsConfig();
  console.log('✅ Config loaded:');
  console.log('  - Version:', config.version);
  console.log('  - Active preset:', config.activePreset);
  console.log('  - Available presets:', Object.keys(config.presets).join(', '));
} catch (error) {
  console.log('❌ FAILED to get config:', error.message);
}

// Test 3: Get scope info
console.log('\nTest 3: Get scope information');
try {
  const scope = getChatSettingsScope();
  console.log('✅ Scope info:', scope);
} catch (error) {
  console.log('❌ FAILED to get scope:', error.message);
}

// Test 4: Save settings (create backup first)
console.log('\nTest 4: Save custom settings');
try {
  const beforeSettings = loadChatSettings();

  // Save modified settings
  saveChatSettings({ temperature: 0.75 }, 'test-script');

  const afterSettings = loadChatSettings();

  if (afterSettings.temperature === 0.75) {
    console.log('✅ Settings saved and reloaded correctly');
    console.log('  - Temperature changed:', beforeSettings.temperature, '→', afterSettings.temperature);
  } else {
    console.log('❌ FAILED: Temperature not updated');
  }

  // Restore original
  saveChatSettings({ temperature: beforeSettings.temperature }, 'test-script');
  console.log('  - Restored original temperature:', beforeSettings.temperature);
} catch (error) {
  console.log('❌ FAILED to save settings:', error.message);
}

// Test 5: Apply preset
console.log('\nTest 5: Apply preset configuration');
try {
  const beforePreset = getChatSettingsConfig().activePreset;

  // Apply focused preset
  const focusedSettings = applyPreset('focused', 'test-script');

  const afterConfig = getChatSettingsConfig();

  if (afterConfig.activePreset === 'focused') {
    console.log('✅ Preset applied successfully');
    console.log('  - Active preset:', beforePreset, '→', afterConfig.activePreset);
    console.log('  - Context influence:', focusedSettings.contextInfluence);
    console.log('  - Temperature:', focusedSettings.temperature);
  } else {
    console.log('❌ FAILED: Preset not applied');
  }

  // Restore balanced preset
  applyPreset('balanced', 'test-script');
  console.log('  - Restored to balanced preset');
} catch (error) {
  console.log('❌ FAILED to apply preset:', error.message);
}

// Test 6: Verify all presets exist
console.log('\nTest 6: Verify all presets are valid');
try {
  const config = getChatSettingsConfig();
  const presetNames = ['balanced', 'focused', 'immersive', 'minimal'];

  let allValid = true;
  for (const presetName of presetNames) {
    if (!config.presets[presetName]) {
      console.log(`❌ FAILED: Preset "${presetName}" not found`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log('✅ All presets exist and are valid');
    presetNames.forEach(name => {
      const preset = config.presets[name];
      console.log(`  - ${name}: temp=${preset.temperature}, context=${preset.contextInfluence}`);
    });
  }
} catch (error) {
  console.log('❌ FAILED to verify presets:', error.message);
}

console.log('\n✨ Chat Settings System Test Complete!\n');
