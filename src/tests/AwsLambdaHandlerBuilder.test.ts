import {APIGatewayProxyEvent, Context} from 'aws-lambda';
import {Observable, of, throwError } from 'rxjs';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import {mockUser, mockUsers, IUser} from '../mock/User';
import {HttpClientAxios} from '@denis_bruns/http-axios';
import {
    IEntityGatewayCrud,
    IGenericFilterQuery,
    IHttpClient,
    IJsonSchema,
    IPaginatedResponse, PayloadTooLargeError, RequestTimeoutError, SchemaValidationError
} from "@denis_bruns/core";
import {awsLambdaHandlerBuilder, IUseCaseInlineFunc} from "../builder/AwsLambdaHandlerBuilder";

const mock = new AxiosMockAdapter(axios);

class TestUserGateway implements IEntityGatewayCrud<
    IUser,
    IUser,
    IGenericFilterQuery,
    string,
    string,
    string,
    boolean
> {
    constructor(private httpClient: IHttpClient) {
    }

    create(query: Partial<IUser>): Observable<IUser> {
        return this.httpClient.post<IUser>("/user", query);
    }

    read(query?: string, filterQuery?: IGenericFilterQuery): Observable<IUser> {
        return this.httpClient.get<IUser>(`/user/${query}`, {}, filterQuery);
    }

    readList(filterQuery?: IGenericFilterQuery): Observable<IPaginatedResponse<IUser>> {
        return this.httpClient.get<IPaginatedResponse<IUser>>("/users", {}, filterQuery);
    }

    updateEntity(entityId: string, query: Partial<IUser>): Observable<IUser> {
        return this.httpClient.patch<IUser>(`/user/${entityId}`, query);
    }

    replaceEntity(entityId: string, query: IUser): Observable<IUser> {
        return this.httpClient.put<IUser>(`/user/${entityId}`, query);
    }

    delete(entityId: string): Observable<boolean> {
        return this.httpClient.delete<boolean>(`/user/${entityId}`);
    }
}

describe('Lambda Handler Tests', () => {
    let userGateway: TestUserGateway;

    const createEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
        body: null,
        headers: {'content-type': 'application/json'},
        multiValueHeaders: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/user',
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {
            accountId: 'test',
            apiId: 'test',
            authorizer: null,
            protocol: 'HTTP/1.1',
            httpMethod: 'POST',
            identity: {
                accessKey: null,
                accountId: null,
                apiKey: null,
                apiKeyId: null,
                caller: null,
                clientCert: null,
                cognitoAuthenticationProvider: null,
                cognitoAuthenticationType: null,
                cognitoIdentityId: null,
                cognitoIdentityPoolId: null,
                principalOrgId: null,
                sourceIp: '127.0.0.1',
                user: null,
                userAgent: null,
                userArn: null
            },
            path: '/user',
            stage: 'test',
            requestId: 'test-123',
            requestTimeEpoch: 1000,
            resourceId: 'test',
            resourcePath: '/user'
        },
        resource: '/user',
        ...overrides
    });

    const mockContext: Context = {
        awsRequestId: 'test-123',
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:test',
        logGroupName: 'test-group',
        logStreamName: 'test-stream',
        memoryLimitInMB: '128',
        done: jest.fn(),
        fail: jest.fn(),
        succeed: jest.fn(),
        getRemainingTimeInMillis: () => 1000
    };

    beforeEach(() => {
        mock.onGet("/users").reply(200, mockUsers(100));
        mock.onGet(/\/user\/\d+/).reply(200, mockUser);
        mock.onPut(/\/user\/\d+/).reply(200, mockUser);
        mock.onPatch(/\/user\/\d+/).reply(200, mockUser);
        mock.onPost("/user").reply(201, mockUser);
        mock.onDelete(/\/user\/\d+/).reply(200, true);

        userGateway = new TestUserGateway(new HttpClientAxios(''));
        jest.spyOn(console, 'log').mockImplementation(() => {
        });
        jest.spyOn(console, 'error').mockImplementation(() => {
        });
    });

    afterEach(() => {
        mock.reset();
    });

    const userSchema: IJsonSchema = {
        type: 'object',
        properties: {
            email: {type: 'string', format: 'email'},
            name: {type: 'string', minLength: 2},
            password: {type: 'string', minLength: 8}
        },
        required: ['email', 'name', 'password'],
        additionalProperties: false
    };

    const createUserHandler: IUseCaseInlineFunc<
        { email: string; name: string },
        { email: string; name: string },
        IUser
    > = (query) => ({
        execute: () => userGateway.create(query.data!!)
    });

    describe('Error Classes', () => {
        it('should create error instances with different messages', () => {
            const schemaError = new SchemaValidationError('Custom schema error');
            expect(schemaError.message).toBe('Custom schema error');
            expect(schemaError.name).toBe('SchemaValidationError');

            const timeoutError = new RequestTimeoutError('Custom timeout');
            expect(timeoutError.message).toBe('Custom timeout');
            expect(timeoutError.name).toBe('RequestTimeoutError');

            const defaultTimeoutError = new RequestTimeoutError();
            expect(defaultTimeoutError.message).toBe('Request timeout');

            const payloadError = new PayloadTooLargeError('Custom payload error');
            expect(payloadError.message).toBe('Custom payload error');
            expect(payloadError.name).toBe('PayloadTooLargeError');

            const defaultPayloadError = new PayloadTooLargeError();
            expect(defaultPayloadError.message).toBe('Response payload too large');
        });
    });

    describe('CORS Validation', () => {
        type InitialQuery = { email: string; name: string };
        type Handlers = [typeof createUserHandler];

        it('should handle undefined whitelist', async () => {
            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [
                    createUserHandler
                ]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                }),
                headers: {
                    'content-type': 'application/json',
                    'origin': 'https://example.com'
                }
            });

            const result = await handler(event, mockContext);
            expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
        });

        it('should handle undefined origin', async () => {
            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers>({
                corsOriginWhitelist: ['https://allowed.com']
            })({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [createUserHandler],
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
        });

        it('should block disallowed origin', async () => {
            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers>({
                corsOriginWhitelist: ['https://allowed.com']
            })({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [createUserHandler]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                }),
                headers: {
                    'content-type': 'application/json',
                    'origin': 'https://disallowed.com'
                }
            });

            const result = await handler(event, mockContext);
            expect(result.headers?.['Access-Control-Allow-Origin']).toBe('null');
        });
    });

    describe('Request Validation', () => {
        type InitialQuery = { email: string; name: string };
        type Handlers = [typeof createUserHandler];

        it('should handle content-type validation', async () => {
            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [createUserHandler],
            });

            const event = createEvent({
                headers: {'content-type': 'text/plain'}
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.message).toContain('Content-Type must be application/json');
        });

        it('should handle schema validation', async () => {
            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [createUserHandler],
                bodySchema: userSchema
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'invalid-email',
                    name: 'T',
                    password: 'short'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body).toHaveProperty('validationErrors');
        });
    });

    describe('Error Handling', () => {
        it('should handle timeout error', async () => {
            const timeoutHandler: IUseCaseInlineFunc<
                { email: string; name: string },
                { email: string; name: string },
                IUser
            > = () => ({
                execute: () => new Observable<IUser>(() => {
                    return () => {};
                })
            });

            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof timeoutHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [timeoutHandler],
                timeoutMs: 100 // Set timeout to 100ms but operation takes 200ms
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(408);
            const body = JSON.parse(result.body);
            expect(body.message).toBe('Request timeout');
        });

        it('should handle large response payload', async () => {
            const largeDataHandler: IUseCaseInlineFunc<
                { email: string; name: string },
                { email: string; name: string },
                { data: string }
            > = () => ({
                execute: () => of({data: 'x'.repeat(7 * 1024 * 1024)})
            });

            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof largeDataHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>({
                maxResponseSize: 1024
            })({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    },
                },
                handlers: [largeDataHandler]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(413);
            const body = JSON.parse(result.body);
            expect(body.message).toBe('Response payload too large');
        });

        it('should handle custom error status codes', async () => {
            class CustomError extends Error {
                constructor() {
                    super('Custom error');
                    this.name = 'CustomError';
                }
            }

            const errorHandler: IUseCaseInlineFunc<
                { email: string; name: string },
                { email: string; name: string },
                Observable<never>
            > = () => ({
                execute: () => throwError(() => new CustomError())
            });

            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof errorHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [errorHandler],
                errorToStatusCodeMapping: {
                    418: [CustomError]
                }
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(418);
            const body = JSON.parse(result.body);
            expect(body.message).toBe('Custom error');
        });
    });

    describe('Success Cases', () => {
        it('should handle empty observable result', async () => {
            const emptyHandler: IUseCaseInlineFunc<{ email: string; name: string }, {
                email: string;
                name: string
            }, null> = () => ({
                execute: () => of(null)
            });

            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof emptyHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [emptyHandler]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(200);
            expect(result.body).toBe('null');
        });

        it('should handle successful user creation', async () => {
            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof createUserHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>()({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']"
                    }
                },
                handlers: [createUserHandler]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User',
                    password: 'password123'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(200);
            if (!result.headers) fail('Headers should be defined');
            expect(result.headers['Content-Type']).toBe('application/json');
            const body = JSON.parse(result.body);
            expect(body).toHaveProperty('id');
            expect(body).toHaveProperty('name');
        });

        it('should handle crud operations through gateway', async () => {
            const readData = await userGateway.read("1", {
                filters: [
                    {
                        field: 'name',
                        operator: "=",
                        value: 'hello world'
                    }
                ],
                pagination: {}
            }).toPromise();
            expect(readData).toMatchSnapshot();

            const readListData = await userGateway.readList().toPromise();
            expect(readListData).toMatchSnapshot();

            const createData = await userGateway.create(mockUser).toPromise();
            expect(createData).toMatchSnapshot();

            const patchData = await userGateway.updateEntity("1", mockUser).toPromise();
            expect(patchData).toMatchSnapshot();

            const putData = await userGateway.replaceEntity("1", mockUser).toPromise();
            expect(putData).toMatchSnapshot();

            const deleteData = await userGateway.delete("1").toPromise();
            expect(deleteData).toMatchSnapshot();
        });
    });

    describe('Custom Configurations', () => {
        it('should handle custom security headers', async () => {
            type InitialQuery = { email: string; name: string };
            type Handlers = [typeof createUserHandler];

            const handler = awsLambdaHandlerBuilder<InitialQuery, Handlers, []>({
                headers: {
                    'Custom-Security-Header': 'test-value'
                }
            })({
                initialQueryReflector: {
                    data: {
                        email: "$['body']['email']",
                        name: "$['body']['name']",
                    },
                },
                handlers: [createUserHandler]
            });

            const event = createEvent({
                body: JSON.stringify({
                    email: 'test@example.com',
                    name: 'Test User'
                })
            });

            const result = await handler(event, mockContext);
            expect(result.headers?.['Custom-Security-Header']).toBe('test-value');
        });
    });

});