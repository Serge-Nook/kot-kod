export class AppError extends Error {
  constructor(
    public code: string,
    message?: string,
    public details?: string
  ) {
    super(message ?? code)
  }
}
