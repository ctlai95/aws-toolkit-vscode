/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as child_process from 'child_process' // eslint-disable-line no-restricted-imports
import * as nodefs from 'fs' // eslint-disable-line no-restricted-imports
import { join } from 'path'
import * as readlineSync from 'readline-sync'
import * as crypto from 'crypto'

const directory = join(process.cwd(), '.changes', 'next-release')
const changeTypes = ['Breaking Change', 'Feature', 'Bug Fix', 'Deprecation', 'Removal', 'Test']

interface NewChange {
    type: string
    description: string
}

function promptForType(): string {
    while (true) {
        const response = readlineSync.keyInSelect(changeTypes, 'Please enter the type of change')
        if (response === -1) {
            console.log('Cancelling change')
            process.exit(0)
        }
        if (response >= 0 && response < changeTypes.length) {
            return changeTypes[response]
        }
        console.log('Invalid change type, change type must be between 0 and 5')
    }
}

function promptForChange(): string {
    while (true) {
        const response = readlineSync.question('Change message: ').trim()
        if (response) {
            return response
        }
    }
}

nodefs.mkdirSync(directory, { recursive: true })

const type = promptForType()
const description = promptForChange()
const contents: NewChange = {
    type: type,
    description: description,
}
const fileName = `${type}-${crypto.randomUUID()}.json`
const path = join(directory, fileName)
nodefs.writeFileSync(path, JSON.stringify(contents, undefined, '\t') + '\n')

console.log(`Change log written to ${path}`)
child_process.execSync(`git add ${directory}`)
console.log('Change log added to git working directory')
