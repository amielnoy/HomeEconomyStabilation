export class HttpStatus {
  static readonly OK = 200;
  static readonly NO_CONTENT = 204;
  static readonly BAD_REQUEST = 400;
  static readonly UNAUTHORIZED = 401;
  static readonly NOT_FOUND = 404;
  static readonly METHOD_NOT_ALLOWED = 405;
  static readonly CONTENT_TOO_LARGE = 413;
  static readonly INTERNAL_SERVER_ERROR = 500;
  static readonly BAD_GATEWAY = 502;
  static readonly SERVICE_UNAVAILABLE = 503;

  private constructor() {}
}
