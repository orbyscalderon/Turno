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
    // En la configuración de entorno y los scripts de arranque sí se usa console.
    files: ["src/config/**", "src/bootstrap-admin.ts", "prisma/**"],
    rules: { "no-console": "off" },
  },
);
