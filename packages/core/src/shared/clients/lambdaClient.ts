/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Lambda } from 'aws-sdk'
import { _Blob } from 'aws-sdk/clients/lambda'
import { ToolkitError } from '../errors'
import globals from '../extensionGlobals'
import { getLogger } from '../logger/logger'
import { ClassToInterfaceType } from '../utilities/tsUtils'

import { LambdaClient as LambdaSdkClient, GetFunctionCommand, GetFunctionCommandOutput } from '@aws-sdk/client-lambda'
import { CancellationError } from '../utilities/timeoutUtils'
import { fromSSO } from '@aws-sdk/credential-provider-sso'
import { getIAMConnection } from '../../auth/utils'

export type LambdaClient = ClassToInterfaceType<DefaultLambdaClient>

export class DefaultLambdaClient {
    private readonly defaultTimeoutInMs: number

    public constructor(public readonly regionCode: string) {
        this.defaultTimeoutInMs = 5 * 60 * 1000 // 5 minutes (SDK default is 2 minutes)
    }

    public async deleteFunction(name: string): Promise<void> {
        const sdkClient = await this.createSdkClient()

        const response = await sdkClient
            .deleteFunction({
                FunctionName: name,
            })
            .promise()

        if (response.$response.error) {
            throw response.$response.error
        }
    }

    public async invoke(name: string, payload?: _Blob): Promise<Lambda.InvocationResponse> {
        const sdkClient = await this.createSdkClient()

        const response = await sdkClient
            .invoke({
                FunctionName: name,
                LogType: 'Tail',
                Payload: payload,
            })
            .promise()

        return response
    }

    public async *listFunctions(): AsyncIterableIterator<Lambda.FunctionConfiguration> {
        const client = await this.createSdkClient()

        const request: Lambda.ListFunctionsRequest = {}
        do {
            const response: Lambda.ListFunctionsResponse = await client.listFunctions(request).promise()

            if (response.Functions) {
                yield* response.Functions
            }

            request.Marker = response.NextMarker
        } while (request.Marker)
    }

    public async getFunction(name: string): Promise<Lambda.GetFunctionResponse> {
        getLogger().debug(`GetFunction called for function: ${name}`)
        const client = await this.createSdkClient()

        try {
            const response = await client.getFunction({ FunctionName: name }).promise()
            // prune `Code` from logs so we don't reveal a signed link to customer resources.
            getLogger().debug('GetFunction returned response (code section pruned): %O', {
                ...response,
                Code: 'Pruned',
            })
            return response
        } catch (e) {
            getLogger().error('Failed to get function: %s', e)
            throw e
        }
    }

    public async getLayerVersion(name: string, version: number): Promise<Lambda.GetLayerVersionResponse> {
        getLogger().debug(`getLayerVersion called for LayerName: ${name}, VersionNumber ${version}`)
        const client = await this.createSdkClient()

        try {
            const response = await client.getLayerVersion({ LayerName: name, VersionNumber: version }).promise()
            // prune `Code` from logs so we don't reveal a signed link to customer resources.
            getLogger().debug('getLayerVersion returned response (code section pruned): %O', {
                ...response,
                Code: 'Pruned',
            })
            return response
        } catch (e) {
            getLogger().error('Failed to get function: %s', e)
            throw e
        }
    }

    public async *listLayerVersions(name: string): AsyncIterableIterator<Lambda.LayerVersionsListItem> {
        const client = await this.createSdkClient()

        const request: Lambda.ListLayerVersionsRequest = { LayerName: name }
        do {
            const response: Lambda.ListLayerVersionsResponse = await client.listLayerVersions(request).promise()

            if (response.LayerVersions) {
                yield* response.LayerVersions
            }

            request.Marker = response.NextMarker
        } while (request.Marker)
    }

    public async getFunctionUrlConfigs(name: string): Promise<Lambda.FunctionUrlConfigList> {
        getLogger().debug(`GetFunctionUrlConfig called for function: ${name}`)
        const client = await this.createSdkClient()

        try {
            const request = client.listFunctionUrlConfigs({ FunctionName: name })
            const response = await request.promise()
            // prune `Code` from logs so we don't reveal a signed link to customer resources.
            getLogger().debug('GetFunctionUrlConfig returned response (code section pruned): %O', {
                ...response,
                Code: 'Pruned',
            })
            return response.FunctionUrlConfigs
        } catch (e) {
            throw ToolkitError.chain(e, 'Failed to get Lambda function URLs')
        }
    }

    public async updateFunctionCode(name: string, zipFile: Uint8Array): Promise<Lambda.FunctionConfiguration> {
        getLogger().debug(`updateFunctionCode called for function: ${name}`)
        const client = await this.createSdkClient()

        try {
            const response = await client
                .updateFunctionCode({
                    FunctionName: name,
                    Publish: true,
                    ZipFile: zipFile,
                })
                .promise()
            getLogger().debug('updateFunctionCode returned response: %O', response)
            await client.waitFor('functionUpdated', { FunctionName: name }).promise()

            return response
        } catch (e) {
            getLogger().error('Failed to run updateFunctionCode: %s', e)
            throw e
        }
    }

    private async createSdkClient(): Promise<Lambda> {
        return await globals.sdkClientBuilder.createAwsService(
            Lambda,
            { httpOptions: { timeout: this.defaultTimeoutInMs } },
            this.regionCode
        )
    }
}

export async function getFunctionWithCredentials(region: string, name: string): Promise<GetFunctionCommandOutput> {
    const connection = await getIAMConnection({
        prompt: true,
        messageText: 'Opening a Lambda Function requires you to be authenticated.',
    })

    if (!connection) {
        throw new CancellationError('user')
    }

    const credentials =
        connection.type === 'iam' ? await connection.getCredentials() : fromSSO({ profile: connection.id })
    const client = new LambdaSdkClient({ region, credentials })

    const command = new GetFunctionCommand({ FunctionName: name })
    return client.send(command)
}
