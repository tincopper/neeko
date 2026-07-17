import { describe, expect, it } from 'vitest';
import {
  cleanRawCommandError,
  getInvokeErrorMessage,
  mapPrLoadError,
} from '../prLoadError';

describe('getInvokeErrorMessage', () => {
  it('should_return_string_error_as_is', () => {
    expect(getInvokeErrorMessage('boom', 'fallback')).toBe('boom');
  });

  it('should_return_Error_message', () => {
    expect(getInvokeErrorMessage(new Error('from-error'), 'fallback')).toBe('from-error');
  });

  it('should_return_fallback_when_empty', () => {
    expect(getInvokeErrorMessage('', 'fallback')).toBe('fallback');
    expect(getInvokeErrorMessage(null, 'fallback')).toBe('fallback');
    expect(getInvokeErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('cleanRawCommandError', () => {
  it('should_decode_stderr_byte_array_from_legacy_error', () => {
    const text = "GraphQL: Could not resolve to a Repository with the name 'liusy0101/codeant'. (repository)\n";
    const bytes = Array.from(new TextEncoder().encode(text)).join(', ');
    const raw = `Unknown error: Command failed with code 1: stdout=[], stderr=[${bytes}]`;
    const cleaned = cleanRawCommandError(raw);
    expect(cleaned).toContain('Could not resolve to a Repository');
    expect(cleaned).toContain('liusy0101/codeant');
    expect(cleaned).not.toContain('stderr=[');
  });

  it('should_strip_git_error_prefix', () => {
    expect(
      cleanRawCommandError(
        "Git error: Repository 'o/r' was not found or you don't have access.",
      ),
    ).toContain("Repository 'o/r'");
  });
});

describe('mapPrLoadError', () => {
  it('should_map_repo_not_found_to_access_title', () => {
    const view = mapPrLoadError(
      "Git error: Repository 'liusy0101/codeant' was not found or you don't have access. Check the remote URL.",
    );
    expect(view.title).toBe("Can't access this repository");
    expect(view.detail).toContain('liusy0101/codeant');
    expect(view.hint).toMatch(/remote|permission|token/i);
    expect(view.action).toBe('retry');
  });

  it('should_map_legacy_byte_array_graphql_error', () => {
    const text =
      "GraphQL: Could not resolve to a Repository with the name 'liusy0101/codeant'. (repository)\n";
    const bytes = Array.from(new TextEncoder().encode(text)).join(', ');
    const raw = `Unknown error: Command failed with code 1: stdout=[], stderr=[${bytes}]`;
    const view = mapPrLoadError(raw);
    expect(view.title).toBe("Can't access this repository");
    expect(view.detail).toContain('liusy0101/codeant');
  });

  it('should_map_auth_failure', () => {
    const view = mapPrLoadError(
      'GitHub authentication failed. Run `gh auth login` or refresh your token.',
    );
    expect(view.title).toBe('GitHub authentication required');
    expect(view.action).toBe('auth');
  });

  it('should_map_network_failure', () => {
    const view = mapPrLoadError(
      'Network error while contacting GitHub. Check your connection and try again.',
    );
    expect(view.title).toBe("Couldn't reach GitHub");
    expect(view.action).toBe('retry');
  });

  it('should_fallback_to_generic_title', () => {
    const view = mapPrLoadError('something weird happened');
    expect(view.title).toBe('Failed to load pull requests');
    expect(view.detail).toBe('something weird happened');
    expect(view.action).toBe('retry');
  });
});
