// ESLint 9 (flat config) para el backend.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "prisma/migrations/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        NodeJS: "readonly",
        RequestInit: "readonly",
      },
    },
    rules: {
      // `_algo` para parámetros que el contrato obliga a declarar pero no se usan.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // El `any` tapa errores reales: se avisa, no se bloquea el build.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    // En la configuración de entorno, el seed y los scripts de línea de comandos
    // la salida por consola ES la interfaz: ahí console.log no es un olvido.
    files: ["src/config/**", "src/bootstrap-admin.ts", "prisma/**", "scripts/**"],
    rules: { "no-console": "off" },
  },
);
