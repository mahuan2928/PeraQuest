import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
export default [{ignores:['**/dist/**','**/coverage/**','apps/mobile/android/app/src/main/assets/public/**','apps/mobile/ios/App/App/public/**']},eslint.configs.recommended,...tseslint.configs.recommended,...vue.configs['flat/recommended'],{files:['**/*.{ts,vue}'],languageOptions:{parserOptions:{parser:tseslint.parser,extraFileExtensions:['.vue']},globals:{...globals.browser,...globals.node}},rules:{'vue/multi-word-component-names':'off'}}]
