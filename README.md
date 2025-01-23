# @denis_bruns/aws-lambda-handler

> **A powerful AWS Lambda handler builder that offers JSON Schema validation, async/Observable flows, and various configurations.**  

[![NPM Version](https://img.shields.io/npm/v/@denis_bruns/aws-lambda-handler?style=flat-square&logo=npm)](https://www.npmjs.com/package/@denis_bruns/aws-lambda-handler)  
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)  
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)  
[![GitHub](https://img.shields.io/badge/GitHub-181717.svg?style=flat-square&logo=github)](https://github.com/h3llf1r33/aws-lambda-handler)

---

## Overview

`@denis_bruns/aws-lambda-handler` streamlines building AWS Lambda handlers by integrating:

- **AJV JSON Schema validation** with custom formats and error messages.
- **Data reflection** via [`@denis_bruns/reflection`](https://www.npmjs.com/package/@denis_bruns/reflection) to extract and transform request data.
- **RxJS-powered use case chaining**, allowing each “handler” (use case) to process and transform the request in sequence.
- **CORS and security headers**: Default security headers and origin validation (with an optional whitelist) are automatically added.
- **Timeout and payload size control**: Configurable options trigger errors if a request exceeds the allowed execution time or response size.
- **Custom error-to-status mappings**: Easily map custom error classes to specific HTTP status codes.

This library is ideal for AWS Lambda projects built with clean architecture principles and TypeScript, and it can work in both pure Lambda and NestJS contexts.

---

## Key Features

- **JSON Schema Validation**  
  Validate the incoming request body using AJV. If validation fails, a `SchemaValidationError` containing all validation errors is thrown.

- **Data Reflection**  
  Leverage flexible data reflectors to extract properties from complex request objects. The reflector can use JSONPath expressions or custom functions to shape your initial query.

- **RxJS Use Case Chaining**  
  Chain multiple "use case" functions (inline functions) where each function receives the output of the previous stage. The builder supports both Promises and RxJS Observables.

- **Built‑in CORS & Security Headers**  
  Automatically sets default security headers and validates the request’s origin against an optional whitelist.

- **Timeout and Payload Control**  
  Optionally enforce a maximum execution timeout (default ~29 seconds) and reject responses that exceed a specified maximum payload size.

- **Custom Error Mappings**  
  Map specific error classes (like `RequestTimeoutError` or `PayloadTooLargeError`) to custom HTTP status codes.

---

## Installation

Using **npm**:

```bash
npm install @denis_bruns/aws-lambda-handler
```

Or with **yarn**:

```bash
yarn add @denis_bruns/aws-lambda-handler
```

You'll also need to install its peer dependencies if you haven't already:

```bash
npm install ajv ajv-formats ajv-errors rxjs @denis_bruns/reflection @denis_bruns/core
```

---

## Basic Usage

Below is an example that shows how you can build an AWS Lambda handler using the builder. In this example, we define a simple use case that creates a user.

```ts
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { of, firstValueFrom, from, switchMap, timeout, map } from "rxjs";
import { v4 } from 'uuid';
import { awsLambdaHandlerBuilder, IUseCaseInlineFunc } from "@denis_bruns/aws-lambda-handler";
import { IJsonSchema, IQueryType, RequestTimeoutError, PayloadTooLargeError, SchemaValidationError } from "@denis_bruns/core";
import { reflect } from "@denis_bruns/reflection";

// Define a JSON schema for validating the request body
const userSchema: IJsonSchema = {
    type: 'object',
    properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 2 },
        password: { type: 'string', minLength: 8 },
    },
    required: ['email', 'name', 'password'],
    additionalProperties: false,
};

// Define a simple use-case function (inline) for creating a user
const createUserUseCase: IUseCaseInlineFunc<{ email: string; name: string; password: string }, { email: string; name: string }, { id: string; name: string }> =
    (query) => ({
        execute: () => {
            // This is a stub for user creation logic.
            // In a real application, you might call a service or interact with a database.
            return of({ id: v4(), name: query.data?.name! });
        }
    });

// Build the Lambda handler using the builder function
const handler = awsLambdaHandlerBuilder<{ email: string; name: string; password: string }, [typeof createUserUseCase]>()({
    // Reflect the data out of the incoming event (using JSONPath)
    initialQueryReflector: {
        data: {
            email: "$['body']['email']",
            name: "$['body']['name']",
            password: "$['body']['password']",
        }
    },
    // Provide the chain of use-case handlers
    handlers: [createUserUseCase],
    // Optionally validate the request body with our schema
    bodySchema: userSchema,
    // Optional: set a timeout in milliseconds (default is ~29 seconds)
    timeoutMs: 3000,
    // Optional: specify custom error-to-status code mappings
    errorToStatusCodeMapping: {
        400: [SchemaValidationError],
        408: [RequestTimeoutError],
        413: [PayloadTooLargeError],
    }
}, {
    // Handler options for CORS and security headers
    corsOriginWhitelist: ['https://allowed-domain.com'],
    maxResponseSize: 3 * 1024 * 1024, // 3 MB
    headers: {
        'X-Custom-Security': 'MyCustomValue',
    }
});

// AWS Lambda handler export
export const lambdaHandler = handler;
```

### Explanation

- **Initial Query Reflector:**  
  Uses JSONPath expressions (or could use custom functions) to extract fields from the incoming event.
- **Use Case Handlers:**  
  You can chain multiple functions; in this case, we have a single use case that creates a user.
- **Schema Validation:**  
  If the request body does not conform to the provided JSON schema, a `SchemaValidationError` is thrown.
- **Timeout and Payload Checks:**  
  If execution exceeds the configured timeout or the response payload is too large, appropriate errors are returned with proper status codes.
- **CORS & Security Headers:**  
  The handler automatically sets security headers and validates the request origin against an optional whitelist.

---

## Advanced Usage

You can customize behavior by:
- Defining nested or multi‑step use cases,
- Adjusting JSON Schema validation with custom AJV formats or keywords,
- Overriding default error status mappings,
- Configuring custom CORS behaviors via the `corsOriginWhitelist` option.

For example, to map a custom error:

```ts
class CustomNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CustomNotFoundError';
    }
}

const notFoundUseCase: IUseCaseInlineFunc<any, any, any> = () => ({
    execute: () => {
        throw new CustomNotFoundError('User not found');
    }
});

const customHandler = awsLambdaHandlerBuilder<any, [typeof notFoundUseCase]>()({
    initialQueryReflector: { data: {} },
    handlers: [notFoundUseCase],
    errorToStatusCodeMapping: { 404: [CustomNotFoundError] }
});
```

---

## Related Packages

- **@denis_bruns/core**  
  [![NPM](https://img.shields.io/npm/v/@denis_bruns/core?style=flat-square&logo=npm)](https://www.npmjs.com/package/@denis_bruns/core)  
  [![GitHub](https://img.shields.io/badge/GitHub--181717.svg?style=flat-square&logo=github)](https://github.com/h3llf1r33/core)  
  *Provides core interfaces, types, and error classes used throughout the ecosystem.*

- **@denis_bruns/reflection**  
  [![NPM](https://img.shields.io/npm/v/@denis_bruns/reflection?style=flat-square&logo=npm)](https://www.npmjs.com/package/@denis_bruns/reflection)  
  [![GitHub](https://img.shields.io/badge/GitHub--181717.svg?style=flat-square&logo=github)](https://github.com/h3llf1r33/reflection)  
  *Used to extract and transform request data via JSONPath expressions or functions.*

- **@denis_bruns/aws-lambda-handler** (this package)  
  *Builds customizable, secure, and robust AWS Lambda handlers using RxJS and AJV.*

- **@denis_bruns/http-axios** (if applicable)  
  *An Axios-based HTTP client following similar design principles for backend integration.*

---

## Contributing

Contributions, bug reports, and feature suggestions are welcome!  
Please open an issue or submit a pull request on [GitHub](https://github.com/h3llf1r33/aws-lambda-handler).

---

## License

This project is [MIT licensed](LICENSE).

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/h3llf1r33">h3llf1r33</a>
</p>