import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
      'no-param-reassign': 'error',
    },
  },
)
