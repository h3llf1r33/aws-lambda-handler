import {APIGatewayProxyEvent, APIGatewayProxyResult, Context} from "aws-lambda";
import {EmptyError, firstValueFrom, from, map, Observable, switchMap, timeout} from "rxjs";
import Ajv, {ErrorObject, FormatDefinition, KeywordDefinition} from "ajv";
import addFormats from "ajv-formats";
import {
    DataReflector,
    DynamicHandlerChain,
    HttpMethodType,
    IHttpHeaders, IJsonSchema,
    IQueryType,
    IUseCase, PayloadTooLargeError,
    RequestContext, RequestTimeoutError, SchemaValidationError
} from "@denis_bruns/core";
import {reflect} from "@denis_bruns/reflection";
import ajvErrors from "ajv-errors";

// Override from @denis_bruns/core to also support ILambdaRequestContext
export type IUseCaseInlineFunc<
    FUNC_DTO,
    USECASE_QUERY,
    USECASE_RESPONSE
> = (
    query: IQueryType<FUNC_DTO>,
    context: RequestContext
) => IUseCase<USECASE_QUERY, USECASE_RESPONSE>;


interface HandlerBuilderConfig {
    maxResponseSize?: number;
    allowedMethods?: readonly string[];
    headers?: IHttpHeaders;
    corsOriginWhitelist?: string[];
}

const validateOrigin = (requestOrigin: string | undefined, whitelist: string[] | undefined): string => {
    if (!whitelist || !requestOrigin) return '*';
    return whitelist.includes(requestOrigin) ? requestOrigin : 'null';
};

const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    validateSchema: true,
    removeAdditional: true,
    useDefaults: true,
    coerceTypes: true,
});

addFormats(ajv);

ajvErrors(ajv, {
    singleError: true,
});


const formatErrors = (errors: ErrorObject[] | null | undefined) => {
    if (!errors || errors.length === 0) return [];

    const result: Array<{ key: string; message: string }> = [];

    errors.forEach(error => {
        const pathSegments = error.instancePath
            .split('/')
            .filter(Boolean);

        let key: string;
        if (pathSegments.length > 0) {
            key = pathSegments.join('.');
        } else if (error.params.missingProperty) {
            const parentPath = pathSegments.join('.');
            key = parentPath ? `${parentPath}.${error.params.missingProperty}` : error.params.missingProperty;
        } else if (error.params.additionalProperty) {
            const parentPath = pathSegments.join('.');
            key = parentPath ? `${parentPath}.${error.params.additionalProperty}` : error.params.additionalProperty;
        } else if (error.params.format) {
            key = pathSegments.length > 0 ? pathSegments.join('.') : error.params.format;
        } else {
            key = 'generic';
        }

        if (error.keyword === 'errorMessage' && error.params.errors) {
            error.params.errors.forEach((err: any) => {
                if (typeof error.schema === 'object' && error.schema !== null) {
                    const msg = (error.schema as any)[err.keyword];
                    if (msg) {
                        result.push({
                            key,
                            message: msg
                        });
                    }
                }
            });
        } else if(error.message) {
            result.push({
                key,
                message: error.message
            });
        }
    });

    return result;
};

export const validate = (schema: IJsonSchema, data: unknown) => {

    const validator = ajv.compile(schema);
    const valid = validator(data);

    if (!valid) {
        const formattedErrors = formatErrors(validator.errors);

        throw new SchemaValidationError(
            'Validation failed',
            formattedErrors
        );
    }
    return data;
};

const emailFormat: FormatDefinition<string> = {
    type: 'string',
    validate: (data: string): boolean => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data);
    },
};

ajv.addFormat('email', emailFormat);

const customErrorsKeyword: KeywordDefinition = {
    keyword: 'customErrors',
    validate: (schema: any, data: any) => true,
    errors: true
};

ajv.addKeyword(customErrorsKeyword);

const DEFAULT_MAX_RESPONSE_SIZE = 6 * 1024 * 1024;
const DEFAULT_TIMEOUT = 29000;
const DEFAULT_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as HttpMethodType[];

const DEFAULT_SECURITY_HEADERS: IHttpHeaders = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache'
};

export const awsLambdaHandlerBuilder = <
    INITIAL_QUERY_DTO extends Record<string, any> | undefined,
    HANDLERS extends readonly IUseCaseInlineFunc<any, unknown, any>[],
    REQUEST_BODY_DTO extends Record<string, any> = {},
    TARGET_BODY_TYPE extends Record<string, any> = {}
>(builderConfig: HandlerBuilderConfig = {}) => {
    const {
        maxResponseSize = DEFAULT_MAX_RESPONSE_SIZE,
        allowedMethods = DEFAULT_ALLOWED_METHODS,
        headers: securityHeaders = DEFAULT_SECURITY_HEADERS,
        corsOriginWhitelist
    } = builderConfig;

    return (
        config: {
            handlers: DynamicHandlerChain<INITIAL_QUERY_DTO, HANDLERS>;
            initialBodyReflector?: DataReflector<REQUEST_BODY_DTO, TARGET_BODY_TYPE>;
            initialQueryReflector?: DataReflector<APIGatewayProxyEvent, IQueryType<INITIAL_QUERY_DTO>>;
            errorToStatusCodeMapping?: Record<number, Array<new (...args: any[]) => Error>>;
            bodySchema?: IJsonSchema;
            timeoutMs?: number;
        }
    ) => {

        return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
            const startTime = Date.now();

            try {
                if (['POST', 'PUT'].includes(event.httpMethod) &&
                    !event.headers['content-type']?.includes('application/json')) {
                    throw new Error('Content-Type must be application/json');
                }

                if (config.bodySchema) {
                    const bodyData = JSON.parse(event.body || "{}")
                    validate(config.bodySchema, bodyData);
                }

                const initialBody = config.initialBodyReflector
                    ? reflect(config.initialBodyReflector, JSON.parse(event.body || ""))
                    : {} as TARGET_BODY_TYPE;

                if (Object.keys(initialBody).length > 0) event.body = JSON.stringify(initialBody)

                let initialQuery = config.initialQueryReflector
                    ? {...reflect(config.initialQueryReflector, event)}
                    : ({} as IQueryType<INITIAL_QUERY_DTO>);

                let observable = from([initialQuery]);

                for (const createHandler of config.handlers) {
                    observable = observable.pipe(
                        map((query) => {
                            const handler = createHandler(query, event);
                            const result = handler.execute(query);
                            return result instanceof Observable ? firstValueFrom(result) : result;
                        }),
                        switchMap(async result => result ?? null)
                    );
                }

                observable = observable.pipe(
                    timeout({
                        first: config.timeoutMs ?? DEFAULT_TIMEOUT,
                        with: () => {
                            throw new RequestTimeoutError();
                        }
                    })
                );

                const result = await firstValueFrom(observable).catch(error => {
                    if (error instanceof EmptyError) return null;
                    throw error;
                });

                const responseBody = JSON.stringify(result);
                if (Buffer.byteLength(responseBody) > maxResponseSize) {
                    throw new PayloadTooLargeError();
                }

                const allowedOrigin = validateOrigin(event.headers.origin, corsOriginWhitelist);
                const corsHeaders = {'Access-Control-Allow-Origin': allowedOrigin};

                const response = {
                    statusCode: 200,
                    headers: {
                        ...securityHeaders,
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                    },
                    body: responseBody,
                };


                return response;

            } catch (error) {
                let statusCode = 500;

                const errorMapping = {
                    ...config.errorToStatusCodeMapping,
                    400: [...(config.errorToStatusCodeMapping?.[400] || []), SchemaValidationError],
                    408: [RequestTimeoutError],
                    413: [PayloadTooLargeError],
                };

                if (error instanceof Error) {
                    for (const [code, errorTypes] of Object.entries(errorMapping)) {
                        if (errorTypes.some(errorType => error instanceof errorType)) {
                            statusCode = Number(code);
                            break;
                        }
                    }
                }

                const errorBody = {
                    message: error instanceof Error ? error.message : 'Unexpected error occurred',
                    code: statusCode,
                    requestId: context.awsRequestId,
                    timestamp: new Date().toISOString()
                };

                if (error instanceof SchemaValidationError && error.errors) {
                    Object.assign(errorBody, {
                        validationErrors: error.errors.map(err => ({
                            path: err.schemaPath,
                            message: err.message,
                            keyword: err.keyword,
                            params: err.params,
                        }))
                    });
                }

                const allowedOrigin = validateOrigin(event.headers.origin, corsOriginWhitelist);
                const corsHeaders = {'Access-Control-Allow-Origin': allowedOrigin};

                return {
                    statusCode,
                    headers: {
                        ...securityHeaders,
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(errorBody),
                };
            }
        };
    };
};