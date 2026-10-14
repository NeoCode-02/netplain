import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  hooks.configs.flat['recommended-latest'] ?? hooks.configs['recommended-latest'],
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // `const { secret, ...rest } = x` is how we drop fields.
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] } }
)
