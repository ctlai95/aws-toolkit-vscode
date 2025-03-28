/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import AsyncLock from 'async-lock'
import { AppRunnerClient, ServiceSummary } from '../../../shared/clients/apprunner'
import { AppRunnerNode } from './apprunnerNode'

import { toArrayAsync, toMap } from '../../../shared/utilities/collectionUtils'
import { CloudWatchLogsBase } from '../../../awsService/cloudWatchLogs/explorer/cloudWatchLogsNode'
import { AWSResourceNode } from '../../../shared/treeview/nodes/awsResourceNode'

import * as nls from 'vscode-nls'
import { getLogger } from '../../../shared/logger/logger'
import { getIcon } from '../../../shared/icons'
import * as AppRunner from '@aws-sdk/client-apprunner'
import { CloudWatchLogsClient } from '../../../shared/clients/cloudWatchLogs'
import { LogGroup } from '@aws-sdk/client-cloudwatch-logs'
const localize = nls.loadMessageBundle()

const contextBase = 'awsAppRunnerServiceNode'

const operationStatus = {
    START_DEPLOYMENT: localize('AWS.apprunner.operationStatus.deploy', 'Deploying...'), // eslint-disable-line @typescript-eslint/naming-convention
    CREATE_SERVICE: localize('AWS.apprunner.operationStatus.create', 'Creating...'), // eslint-disable-line @typescript-eslint/naming-convention
    PAUSE_SERVICE: localize('AWS.apprunner.operationStatus.pause', 'Pausing...'), // eslint-disable-line @typescript-eslint/naming-convention
    RESUME_SERVICE: localize('AWS.apprunner.operationStatus.resume', 'Resuming...'), // eslint-disable-line @typescript-eslint/naming-convention
    DELETE_SERVICE: localize('AWS.apprunner.operationStatus.delete', 'Deleting...'), // eslint-disable-line @typescript-eslint/naming-convention
    UPDATE_SERVICE: localize('AWS.apprunner.operationStatus.update', 'Updating...'), // eslint-disable-line @typescript-eslint/naming-convention
}

type ServiceOperation = keyof typeof operationStatus

export class AppRunnerServiceNode extends CloudWatchLogsBase implements AWSResourceNode {
    public readonly name: string
    public readonly arn: string
    private readonly lock: AsyncLock = new AsyncLock()
    protected readonly placeholderMessage = localize('AWS.explorerNode.apprunner.nologs', '[No App Runner logs found]')

    constructor(
        public readonly parent: AppRunnerNode,
        private readonly client: AppRunnerClient,
        private _info: ServiceSummary,
        private currentOperation: AppRunner.OperationSummary & { Type?: ServiceOperation } = {},
        cloudwatchClient = new CloudWatchLogsClient(client.regionCode)
    ) {
        super('App Runner Service', parent.regionCode, cloudwatchClient)

        this.iconPath = getIcon('aws-apprunner-service')
        this.id = `AppRunnerService-${_info.ServiceArn}`
        this.name = _info.ServiceName
        this.arn = _info.ServiceArn

        this.update(_info)
    }

    public get info(): Readonly<ServiceSummary> {
        return this._info
    }

    public get url(): string {
        return `https://${this._info.ServiceUrl}`
    }

    protected async getLogGroups(): Promise<Map<string, LogGroup>> {
        return toMap(
            await toArrayAsync(
                this.cloudwatchClient.describeLogGroups({
                    logGroupNamePrefix: `/aws/apprunner/${this._info.ServiceName}/${this._info.ServiceId}`,
                })
            ),
            (configuration) => configuration.logGroupName
        )
    }

    private setLabel(): void {
        const displayStatus = this.currentOperation.Type
            ? operationStatus[this.currentOperation.Type]
            : `${this._info.Status.charAt(0)}${this._info.Status.slice(1).toLowerCase().replace(/\_/g, ' ')}`
        this.label = `${this._info.ServiceName} [${displayStatus}]`
    }

    public update(info: ServiceSummary): void {
        // update can be called multiple times during an event loop
        // this would rarely cause the node's status to appear as 'Operation in progress'
        this.lock
            .acquire(this._info.ServiceId, (done) => {
                const lastLabel = this.label
                this.updateInfo(info)
                this.updateStatus(typeof lastLabel === 'string' ? lastLabel : lastLabel?.label)
                done()
            })
            .catch((e) => {
                getLogger().error('AsyncLock.acquire failed: %s', e.message)
            })
    }

    private updateStatus(lastLabel?: string): void {
        if (this.label !== lastLabel && lastLabel !== 'App Runner Service') {
            this.refresh()
        }

        if (this._info.Status === 'DELETED') {
            this.parent.deleteNode(this._info.ServiceArn)
            this.parent.refresh()
        }

        if (this._info.Status === 'OPERATION_IN_PROGRESS') {
            this.parent.startPollingNode(this._info.ServiceArn)
        } else if (this.currentOperation.Type !== undefined) {
            this.currentOperation.Id = undefined
            this.currentOperation.Type = undefined
            this.setLabel()
            this.parent.stopPollingNode(this._info.ServiceArn)
        }
    }

    private async updateOperation(): Promise<void> {
        return this.client
            .listOperations({ MaxResults: 1, ServiceArn: this._info.ServiceArn })
            .then((resp) => {
                const operations = resp.OperationSummaryList
                const operation = operations && operations[0]?.EndedAt === undefined ? operations[0] : undefined
                if (operation !== undefined) {
                    this.setOperation(this._info, operation.Id!, operation.Type as any)
                }
            })
            .catch((err) => {
                // Apparently App Runner can rarely list deleted services with the wrong status
                getLogger().warn(
                    `Failed to list operations for service "${this._info.ServiceName}", service may be in an unstable state.`
                )
                getLogger().debug(`Failed to list operations for service "${this.arn}": %s`, err)
            })
    }

    private updateInfo(info: ServiceSummary): void {
        if (info.Status === 'OPERATION_IN_PROGRESS' && this.currentOperation.Type === undefined) {
            // Asynchronous since it is not currently possible for race-conditions to occur with updating operations
            void this.updateOperation()
        }

        this._info = Object.assign(this._info, info)
        this.contextValue = `${contextBase}.${this._info.Status}`
        this.setLabel()
    }

    public async pause(): Promise<void> {
        const resp = await this.client.pauseService({ ServiceArn: this._info.ServiceArn })
        this.setOperation(resp.Service, resp.OperationId, 'PAUSE_SERVICE')
    }

    public async resume(): Promise<void> {
        const resp = await this.client.resumeService({ ServiceArn: this._info.ServiceArn })
        this.setOperation(resp.Service, resp.OperationId, 'RESUME_SERVICE')
    }

    public async delete(): Promise<void> {
        const resp = await this.client.deleteService({ ServiceArn: this._info.ServiceArn })
        this.setOperation(resp.Service, resp.OperationId, 'DELETE_SERVICE')
    }

    public async updateService(request: AppRunner.UpdateServiceRequest): Promise<void> {
        const resp = await this.client.updateService({ ...request, ServiceArn: this._info.ServiceArn })
        this.setOperation(resp.Service, resp.OperationId, 'UPDATE_SERVICE')
    }

    public async deploy(): Promise<void> {
        const resp = await this.client.startDeployment({ ServiceArn: this._info.ServiceArn })
        this.setOperation(this._info, resp.OperationId, 'START_DEPLOYMENT')
    }

    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
    public setOperation(info: ServiceSummary, id?: string, type?: ServiceOperation): void {
        this.currentOperation.Id = id
        this.currentOperation.Type = type
        this.update(info)
    }

    public async describe(): Promise<ServiceSummary> {
        const resp = await this.client.describeService({ ServiceArn: this.arn })
        this.update(resp.Service)
        return this._info
    }
}
