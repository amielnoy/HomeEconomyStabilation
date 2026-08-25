export class HttpStatus {
    static OK = 200;
    static NO_CONTENT = 204;
    static BAD_REQUEST = 400;
    static UNAUTHORIZED = 401;
    static FORBIDDEN = 403;
    static NOT_FOUND = 404;
    static METHOD_NOT_ALLOWED = 405;
    static CONTENT_TOO_LARGE = 413;
    static UNSUPPORTED_MEDIA_TYPE = 415;
    static TOO_MANY_REQUESTS = 429;
    static INTERNAL_SERVER_ERROR = 500;
    static BAD_GATEWAY = 502;
    static SERVICE_UNAVAILABLE = 503;
    static GATEWAY_TIMEOUT = 504;
    constructor() { }
}
