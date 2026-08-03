import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { McpRegistryInput } from '@/features/library/api/libraryApi';

import McpConfigInputs from '../McpConfigInputs';

function makeInput(overrides: Partial<McpRegistryInput>): McpRegistryInput {
  return {
    name: 'TOKEN',
    inputType: null,
    format: 'string',
    isRequired: false,
    isSecret: false,
    isRepeated: false,
    default: null,
    placeholder: null,
    choices: [],
    valueHint: null,
    ...overrides,
  };
}

describe('McpConfigInputs — secret env + 动态 config inputs', () => {
  it('仅渲染 secret env 输入框（非 secret env 由默认值自动合并，不展示输入）', () => {
    render(
      <McpConfigInputs
        env={[
          { name: 'API_KEY', isSecret: true, isRequired: true, default: null },
          { name: 'LOG_LEVEL', isSecret: false, isRequired: false, default: 'info' },
        ]}
        inputs={[]}
        values={{}}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText(/API_KEY/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/LOG_LEVEL/)).not.toBeInTheDocument();
  });

  it('secret env 输入时通过 onChange 上报 name/value', () => {
    const onChange = vi.fn();
    render(
      <McpConfigInputs
        env={[{ name: 'API_KEY', isSecret: true, isRequired: true, default: null }]}
        inputs={[]}
        values={{}}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText(/API_KEY/), { target: { value: 'sk-123' } });
    expect(onChange).toHaveBeenCalledWith('API_KEY', 'sk-123');
  });

  it('渲染动态 inputs：text / secret(password) / boolean(select) / choices(select)', () => {
    render(
      <McpConfigInputs
        env={[]}
        inputs={[
          makeInput({ name: 'HOST', placeholder: 'host' }),
          makeInput({ name: 'PASSWORD', isSecret: true }),
          makeInput({ name: 'DEBUG', format: 'boolean', default: false }),
          makeInput({ name: 'REGION', choices: ['us', 'eu'] }),
        ]}
        values={{ DEBUG: 'false' }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText(/HOST/)).toBeInTheDocument();
    expect(screen.getByLabelText(/PASSWORD/)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/DEBUG/)).toHaveValue('false');
    expect(screen.getByLabelText(/REGION/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'us' })).toBeInTheDocument();
  });

  it('不渲染空配置（无 secret env 且无 inputs）', () => {
    const { container } = render(
      <McpConfigInputs env={[]} inputs={[]} values={{}} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
