// wrangler の Text ルールで .md / .yaml を文字列として import する
declare module '*.md' {
  const text: string;
  export default text;
}
declare module '*.yaml' {
  const text: string;
  export default text;
}
