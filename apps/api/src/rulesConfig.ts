// config/rules.yaml を Worker に文字列 import して解析する（Text ルール: wrangler.jsonc）
import { parse } from 'yaml';
import rulesYaml from '../../../config/rules.yaml';
import type { RulesConfig } from './rules';

let cached: RulesConfig | null = null;

export function getRulesConfig(): RulesConfig {
  if (!cached) cached = parse(rulesYaml) as RulesConfig;
  return cached;
}

export function getRulesYaml(): string {
  return rulesYaml;
}
