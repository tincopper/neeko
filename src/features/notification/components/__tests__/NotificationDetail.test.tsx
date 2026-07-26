import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { NotificationDetail } from '@/features/notification/components/NotificationDetail';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { Notification } from '@/shared/types';

const mockNotification: Notification = {
  id: 'n1',
  type: 'error',
  title: 'Test Error',
  message: 'Something went wrong.',
  timestamp: 1700000000000,
  read: false,
};

describe('NotificationDetail', () => {
  let writeTextMock: vi.Mock<(text: string) => Promise<void>>;

  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    writeTextMock = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies notification content to clipboard when Copy is clicked', async () => {
    writeTextMock.mockResolvedValue(undefined);
    render(<NotificationDetail notification={mockNotification} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining('[Test Error]\nSomething went wrong.'),
      );
    });
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows an error notification when clipboard write fails', async () => {
    writeTextMock.mockRejectedValue(new Error('denied'));
    const addSpy = vi.spyOn(useNotificationStore.getState(), 'addNotification');

    render(<NotificationDetail notification={mockNotification} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy/i }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith({
        type: 'error',
        title: 'Copy failed',
        message: 'Clipboard is not available. Please select and copy the text manually.',
      });
    });
  });
});
