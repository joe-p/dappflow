import {
    ABIArgumentType,
    ABIMethod,
    ABIMethodParams,
    ABITransactionType,
    abiTypeIsTransaction, algosToMicroalgos,
    AtomicTransactionComposer, makeBasicAccountTransactionSigner,
    Transaction,
    TransactionType,
    TransactionWithSigner
} from "algosdk";
import {
    A_ABI_METHOD_EXECUTOR_APP_CREATION_PARAMS,
    A_ABI_METHOD_EXECUTOR_ARG,
    ABI_METHOD_EXECUTOR_SUPPORTED_TXN_TYPES
} from "../types";
import dappflow from "../../../utils/dappflow";
import {BaseTransaction} from "../../core-sdk/transactions/baseTransaction";
import {ApplicationTransaction} from "../../core-sdk/transactions/applicationTransaction";

export default class ABIMethodExecutor {
    method: ABIMethodParams

    constructor(method: ABIMethodParams) {
        this.method = method;
    }

    getArgs(): Array<{ type: ABIArgumentType; name?: string; description?: string }> {
        return  new ABIMethod(this.method).args || [];
    }

    canExecute(): boolean {
        let supported = true;

        const txnTypes = this.getTxnTypes();

        txnTypes.forEach((type) => {
            if (ABI_METHOD_EXECUTOR_SUPPORTED_TXN_TYPES.indexOf(type) === -1) {
                supported = false;
            }
        });

        return supported;
    }

    isGroup(): boolean {
        return new ABIMethod(this.method).txnCount() > 1;
    }

    getTxnTypes(): ABITransactionType[] {
        const txnTypes: ABITransactionType[] = [];

        if (this.isGroup()) {
            const args = this.getArgs();
            for (const arg of args) {
                if (abiTypeIsTransaction(arg.type)) {
                    txnTypes.push(arg.type)
                }
            }
        }

        return txnTypes;
    }

    parseArgumentValue(arg: A_ABI_METHOD_EXECUTOR_ARG): any {
        const dataType = arg.type.toString();
        const val = arg.value;

        switch (dataType) {
            case "uint64":
            case "byte":
            case "asset":
            case "application":
                return BigInt(val);
            case "bool":
                return Boolean(val);
            case "byte[]":
                return new Uint8Array(Buffer.from(val, "base64"));
            default:
                return val;
        }
    }

    getSequenceOfTxnTypes(): string[] {
        const txnTypes: string[] = [];

        const args = this.getArgs();
        args.forEach((arg) => {
            if (abiTypeIsTransaction(arg.type.toString())) {
                txnTypes.push(arg.type.toString());
            }
            else {
                if (txnTypes.indexOf('current') === -1) {
                    txnTypes.push('current');
                }
            }
        });

        return txnTypes;
    }

    async getUnsignedTxns(appId: number, from: string, args: A_ABI_METHOD_EXECUTOR_ARG[] = [], isCreation: boolean = false, params: A_ABI_METHOD_EXECUTOR_APP_CREATION_PARAMS): Promise<TransactionWithSigner[]> {
        const appCallInstance = new ApplicationTransaction(dappflow.network);
        
        const atc = new AtomicTransactionComposer();

        const sp = await new BaseTransaction(dappflow.network).getSuggestedParams();
        const signer = undefined;

        let appCallParams = {
            appID: appId,
            sender: from,
            suggestedParams: {
                ...sp
            },
            signer,
            numGlobalInts: undefined,
            numGlobalByteSlices: undefined,
            numLocalInts: undefined,
            numLocalByteSlices: undefined,
            approvalProgram: undefined,
            clearProgram: undefined,
            note: undefined,
            extraPages: undefined
        }
        
        if (isCreation) {
            appCallParams.appID = 0;
            appCallParams.numGlobalInts = Number(params.globalInts);
            appCallParams.numGlobalByteSlices = Number(params.globalBytes);
            appCallParams.numLocalInts = Number(params.localInts);
            appCallParams.numLocalByteSlices = Number(params.localBytes);
            appCallParams.approvalProgram = appCallInstance.getProgramBytes(params.approvalProgram);
            appCallParams.clearProgram = appCallInstance.getProgramBytes(params.clearProgram);
            appCallParams.note = appCallInstance.toUint8Array(params.note);
            appCallParams.extraPages = Number(params.extraPages);
        }
        else {
            delete appCallParams.numGlobalByteSlices;
            delete appCallParams.numGlobalInts;
            delete appCallParams.numLocalInts;
            delete appCallParams.numLocalByteSlices;
            delete appCallParams.approvalProgram;
            delete appCallParams.clearProgram;
            delete appCallParams.extraPages;
        }

        const methodArgs = args.map((arg) => {
            const val = this.parseArgumentValue(arg);
            if (abiTypeIsTransaction(arg.type.toString())) {
                const txn = new Transaction({type: TransactionType.pay, from: from, to: val.to, amount: algosToMicroalgos(val.amount), ...sp});
                return {
                    txn: txn,
                    signer: makeBasicAccountTransactionSigner({addr: from, sk: undefined})
                };
            }
            else {
                return val;
            }
        }).filter((value) => value !== undefined && value !== "" && value !== null);


        atc.addMethodCall({
            ...appCallParams,
            method: new ABIMethod(this.method),
            methodArgs
        });

        const unsignedTxns= atc.buildGroup();
        return unsignedTxns;
    }
}