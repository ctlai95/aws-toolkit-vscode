/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode'
import sinon from 'sinon'
import assert from 'assert'
import {
    createSecurityDiagnosticCollection,
    securityScanRender,
    removeDiagnostic,
    disposeSecurityDiagnostic,
    SecurityDiagnostic,
    createSecurityDiagnostic,
    codewhispererDiagnosticSourceLabel,
} from 'aws-core-vscode/codewhisperer'
import { createCodeScanIssue, createMockDocument, createTextDocumentChangeEvent } from 'aws-core-vscode/test'

describe('diagnosticsProvider', function () {
    let mockDocument: vscode.TextDocument
    let mockCollection: vscode.DiagnosticCollection

    beforeEach(function () {
        mockDocument = createMockDocument()
        mockCollection = createSecurityDiagnosticCollection()
        securityScanRender.initialized = true
    })

    afterEach(function () {
        sinon.restore()
        mockCollection.clear()
    })

    it('should remove diagnostic by findingId', function () {
        mockCollection.set(mockDocument.uri, [
            { findingId: 'finding1' },
            { findingId: 'finding2' },
        ] as SecurityDiagnostic[])
        sinon.stub(securityScanRender, 'securityDiagnosticCollection').returns(mockCollection)

        removeDiagnostic(mockDocument.uri, createCodeScanIssue({ findingId: 'finding1' }))
        const actual = mockCollection.get(mockDocument.uri) as SecurityDiagnostic[]
        assert.strictEqual(actual.length, 1)
        assert.strictEqual(actual[0].findingId, 'finding2')
    })

    it('should offset diagnostics and fixes by 1 line', function () {
        mockCollection.set(mockDocument.uri, [
            { findingId: 'finding1', range: new vscode.Range(1, 0, 2, 0) },
            { findingId: 'finding2', range: new vscode.Range(3, 0, 4, 0) },
        ] as SecurityDiagnostic[])
        sinon.stub(securityScanRender, 'securityDiagnosticCollection').returns(mockCollection)

        const mockEvent = createTextDocumentChangeEvent(mockDocument, new vscode.Range(0, 0, 0, 0), '\n')
        disposeSecurityDiagnostic(mockEvent)
        const actual = mockCollection.get(mockDocument.uri)
        assert.strictEqual(actual?.length, 2)
        assert.strictEqual(actual[0].range.start.line, 2)
        assert.strictEqual(actual[0].range.end.line, 3)
        assert.strictEqual(actual[1].range.start.line, 4)
        assert.strictEqual(actual[1].range.end.line, 5)
    })

    it('should handle change event with multiple content changes', function () {
        mockCollection.set(mockDocument.uri, [
            { findingId: 'finding1', range: new vscode.Range(1, 0, 2, 0) },
            { findingId: 'finding2', range: new vscode.Range(3, 0, 4, 0) },
        ] as SecurityDiagnostic[])
        sinon.stub(securityScanRender, 'securityDiagnosticCollection').returns(mockCollection)

        const mockEvent: vscode.TextDocumentChangeEvent = {
            reason: undefined,
            document: mockDocument,
            contentChanges: [
                { range: new vscode.Range(0, 0, 0, 0), rangeOffset: 1, rangeLength: 1, text: 'a\n' },
                { range: new vscode.Range(0, 0, 0, 0), rangeOffset: 1, rangeLength: 1, text: 'b\n' },
            ],
        }
        disposeSecurityDiagnostic(mockEvent)
        const actual = mockCollection.get(mockDocument.uri)
        assert.strictEqual(actual?.length, 2)
        assert.strictEqual(actual[0].range.start.line, 3)
        assert.strictEqual(actual[0].range.end.line, 4)
        assert.strictEqual(actual[1].range.start.line, 5)
        assert.strictEqual(actual[1].range.end.line, 6)
    })

    it('should create securityDiagnostic from codeScanIssue', function () {
        const codeScanIssue = createCodeScanIssue()
        const securityDiagnostic = createSecurityDiagnostic(codeScanIssue)
        assert.strictEqual(securityDiagnostic.findingId, codeScanIssue.findingId)
        assert.strictEqual(securityDiagnostic.message, codeScanIssue.title)
        assert.strictEqual(securityDiagnostic.range.start.line, codeScanIssue.startLine)
        assert.strictEqual(securityDiagnostic.range.end.line, codeScanIssue.endLine)
        assert.strictEqual(securityDiagnostic.severity, vscode.DiagnosticSeverity.Warning)
        assert.strictEqual(securityDiagnostic.source, codewhispererDiagnosticSourceLabel)
        assert.strictEqual(securityDiagnostic.code, codeScanIssue.ruleId)
    })
})
