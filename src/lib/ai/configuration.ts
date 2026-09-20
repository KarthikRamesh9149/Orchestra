/** Generation readiness is a capability, not the presence of one vendor's key.
 * Desktop composition sets the provider only after validating its protected
 * configuration. Hosted servers retain their existing OpenAI contract. */
export type DesktopGenerationProvider = 'none' | 'openai' | 'openai-compatible' | 'anthropic' | 'google';
export interface GenerationConfiguration {
  RUNTIME_PROFILE?: string;
  DESKTOP_AI_PROVIDER?: DesktopGenerationProvider;
  OPENAI_API_KEY?: string;
}
export function configuredGenerationProvider(env: GenerationConfiguration): Exclude<DesktopGenerationProvider, 'none'> | null {
  if (env.RUNTIME_PROFILE === 'desktop-local') {
    const provider = env.DESKTOP_AI_PROVIDER;
    return provider && provider !== 'none' ? provider : null;
  }
  return env.OPENAI_API_KEY ? 'openai' : null;
}
export function hasConfiguredGeneration(env: GenerationConfiguration): boolean {
  return configuredGenerationProvider(env) !== null;
}
