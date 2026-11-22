import base from "@beautyspa/config/eslint.base.mjs";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [...base, ...nextVitals, ...nextTs, { ignores: [".next/**", "next-env.d.ts"] }];
