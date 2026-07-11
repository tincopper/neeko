export interface PRComment {
  id: string;
  author: string;
  authorAvatar?: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  reactions?: CommentReaction[];
}

export interface CommentReaction {
  emoji: string;
  count: number;
  userReacted: boolean;
}
