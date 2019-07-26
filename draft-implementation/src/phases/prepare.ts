import { ScpBallot, ScpPrepareEnvelope } from "../types";
import { BroadcastFunction, } from "../protocol";
import ProtocolState from '../ProtocolState';
import { hashBallot, isBallotLower, hashBallotValue, checkQuorumForCounter, checkBlockingSetForCounterPrepare, infinityCounter } from "../helpers";
import { quorumThreshold, blockingThreshold } from "../validateSlices";
import * as _ from 'lodash';

export const prepare = (state: ProtocolState, broadcast: BroadcastFunction, enterCommitPhase: () => void) => {
    const log = (...args: any[]) => state.log(...args);

    const acceptPrepareBallot = (b: ScpBallot) => {
        if (state.addAcceptedPrepared(_.cloneDeep(b))) {
            log('ACCEPT prepare ballot', b.counter, b.value.join(' '));

        }
        // if (!state.acceptedPrepared.find(x => hashBallot(x) === h)) {
        //     state.acceptedPrepared.push(b);
        // }
        // if (state.prepare.prepared === null || isBallotLower(state.prepare.prepared, b)) {
        //     state.prepare.prepared = b;
        // }
        // TODO: Use this?
        // if (isBallotLower(state.prepare.ballot, b)) {
        //     state.prepare.ballot = b;
        // }
    }

    const checkPrepareBallotAcceptQuorum = (ballot: ScpBallot) => {
        // state.log('checkPrepareBallotAccept', ballot)
        // FIXME: What if we're already at another ballot
        // Track other ballots
        // TODO: include all the messages from above
        const ballotHash = hashBallot(ballot);
        // const ballotValueHash = hashBallotValue(ballot)
        const voteOrAccept = state.prepareStorage.getAllValuesAsArary()
            .filter(p => hashBallot(p.ballot) === ballotHash || (p.prepared && hashBallot(p.prepared) === ballotHash))
        const commitVotes = state.commitStorage.getAllValuesAsArary()
            .filter(c => hashBallot({ counter: infinityCounter, value: c.ballot.value }) === ballotHash || hashBallot({ counter: c.preparedCounter, value: c.ballot.value }) === ballotHash);
        const externalizeVotes = state.externalizeStorage.getAllValuesAsArary()
            .filter(e => hashBallot({ counter: infinityCounter, value: e.commit.value }));
        // state.log('For Quorum: ', { prepare: voteOrAccept.map(x => x.node), commit: commitVotes.map(x => x.node), ext: externalizeVotes.map(x => x.node) })
        const signers = [...voteOrAccept, ...commitVotes, ...externalizeVotes].map(p => p.node);
        if (quorumThreshold(state.nodeSliceMap, signers, state.options.self)) {
            log('Prepare Accept Found quorum for ', ballot);
            acceptPrepareBallot(ballot);
            return;
        }
    }

    const checkPrepareBallotAcceptBlockingSet = (ballot: ScpBallot) => {
        // state.log('checkPrepareBallotAccept', ballot)
        // FIXME: What if we're already at another ballot
        // Track other ballots
        // TODO: include all the messages from above
        const ballotHash = hashBallot(ballot);
        const ballotValueHash = hashBallotValue(ballot)

        const commitAccepts = state.commitStorage.getAllValuesAsArary()
            .filter(c => c.ballot && hashBallot({ counter: c.preparedCounter, value: c.ballot.value }) === ballotHash);
        const externalizes = state.externalizeStorage.getAllValuesAsArary()
            .filter(e => e.commit && hashBallotValue(e.commit) === ballotValueHash);
        const acceptPrepares = state.prepareStorage.getAllValuesAsArary()
            .filter(p => p.prepared && hashBallot(p.prepared) === ballotHash);
        // state.log('For Blockingset: ', { prepare: acceptPrepares.map(x => x.node), commit: commitAccepts.map(x => x.node), ext: externalizes.map(x => x.node) })
        const nodes = [...acceptPrepares, ...commitAccepts, ...externalizes].map(p => p.node);
        if (blockingThreshold(state.options.slices, nodes)) {
            log('Prepare Accept Found blocking set for ', ballot);
            acceptPrepareBallot(ballot);
        }
    }

    const checkPrepareBallotAcceptCommit = () => {
        if (!state.prepare.prepared) return;
        // return if not confirmed prepared
        if (state.confirmedPrepared.map(hashBallot).indexOf(hashBallot(state.prepare.prepared)) < 0) return;
        const ballotValueHash = hashBallotValue(state.prepare.prepared)
        const n = state.prepare.prepared.counter;
        const prepareCommitVotes = state.prepareStorage.getAllValuesAsArary()
            .filter(x => hashBallotValue(x.ballot) === ballotValueHash && (x.cCounter <= n && n <= x.hCounter));
        const commits = state.commitStorage.getAllValuesAsArary()
            // accept commit for cCounter <= n <= hCounter && vote for n >= cCounter result in no restrictions for counters 
            .filter(x => hashBallotValue(x.ballot) === ballotValueHash);
        const externalizes = state.externalizeStorage.getAllValuesAsArary()
            .filter(x => hashBallotValue(x.commit) && n >= x.commit.counter);
        const signersVoteOrAccept = [...prepareCommitVotes, ...commits, ...externalizes].map(x => x.node);
        if (quorumThreshold(state.nodeSliceMap, signersVoteOrAccept, state.options.self)) {
            state.addAcceptedCommited(_.cloneDeep(state.prepare.prepared!)) && log('Ballot accepted committed (QT) ', state.prepare.prepared)
        }

        const commitAccepts = state.commitStorage.getAllValuesAsArary()
            .filter(x => hashBallotValue(x.ballot) === ballotValueHash && x.cCounter <= n && n <= x.hCounter);
        const signersAccept = [...commitAccepts, ...externalizes].map(x => x.node);
        if (blockingThreshold(state.options.slices, signersAccept)) {
            state.addAcceptedCommited(_.cloneDeep(state.prepare.prepared)) && log('Ballot accepted committed (BS) ', state.prepare.prepared)
        }
    }


    const checkPrepareBallotConfirm = (ballot: ScpBallot) => {
        // state.log('checkPrepareBallotConfirm', ballot)
        // if (state.options.self === 'B') {
        //     state.log(JSON.stringify([state.prepareStorage.getAllValuesAsArary(), state.commitStorage.getAllValuesAsArary(), state.externalizeStorage.getAllValuesAsArary()], null, 2))
        // }
        // FIXME: include other messages
        const ballotHash = hashBallot(ballot);
        const acceptPrepares = state.prepareStorage.getAllValuesAsArary()
            .filter(p => p.prepared && hashBallot(p.prepared) === ballotHash)
            .map(p => p.node);
        const commits = state.commitStorage.getAllValuesAsArary()
            .filter(c => hashBallot({ counter: c.preparedCounter, value: c.ballot.value }) === ballotHash || hashBallot({ counter: c.hCounter, value: c.ballot.value }) === ballotHash)
            .map(c => c.node);
        const externalizes = state.externalizeStorage.getAllValuesAsArary()
            .filter(e => hashBallotValue(e.commit) === hashBallotValue(ballot))
            .map(e => e.node);
        // state.log({ acceptPrepares, commits, externalizes })
        const signers = _.uniq([...acceptPrepares, ...commits, ...externalizes]);
        if (quorumThreshold(state.nodeSliceMap, signers, state.options.self)) {
            state.addConfirmedPrepared(ballot) && log('Confirmed Prepared ', ballot);
        }
    }



    const recalculatePrepareBallotValue = (): void => {
        //  If any ballot has been confirmed prepared, then "ballot.value"
        // is taken to to be "h.value" for the highest confirmed prepared ballot "h". 
        const highestConfirmed = state.getHighestConfirmedPreparedBallot();
        if (highestConfirmed) {
            log('found highest confirmed')
            state.prepare.ballot.value = _.cloneDeep(highestConfirmed.value);
            return;
        }
        // Otherwise (if no such "h" exists), if one or more values are
        // confirmed nominated, then "ballot.value" is taken as the output
        // of the deterministic combining function applied to all
        // confirmed nominated values.
        if (state.confirmedValues.length) {
            log('using nominated values')
            state.prepare.ballot.value = _.cloneDeep(state.confirmedValues);
            return;
        }

        // Otherwise, if no ballot is confirmed prepared and no value is
        // confirmed nominated, but the node has accepted a ballot
        // prepared (because "prepare(b)" meets blocking threshold for
        // some ballot "b"), then "ballot.value" is taken as the value of
        // the highest such accepted prepared ballot.
        const highestAccepted = state.getHighestAcceptedPreparedBallot();
        if (highestAccepted) {
            state.prepare.ballot.value = _.cloneDeep(highestAccepted.value)
            return;
        }
        log('Can not send PREPARE yet.')
        return;
    }

    const recalculatePreparedField = (): void => {
        // log('Accepted prepared', state.acceptedPrepared);

        //  or NULL if no ballot has been accepted prepared. 
        // if (state.acceptedPrepared.length === 0) state.prepare.prepared = null;
        // The highest accepted prepared ballot not exceeding the "ballot" field
        const highest = state.getHighestAcceptedPreparedBallot();
        if (!highest) {
            state.prepare.prepared = null;
            return;
        }
        if (isBallotLower(state.prepare.ballot, highest)) {
            state.prepare.prepared = { value: _.cloneDeep(highest.value), counter: state.prepare.ballot.counter - 1 }
        }
        else {
            state.prepare.prepared = _.cloneDeep(highest);
        }
        log('Set prepare field to ', state.prepare.prepared)
        // const ballotsLowerOrEqualThanPrepare = state.acceptedPrepared.filter(b => isBallotLowerOrEqual(b, state.prepare.ballot))
        // if (ballotsLowerOrEqualThanPrepare.length) {
        //     const highestAcceptedPreparedBallotNotExceedingBallotField =
        //         ballotsLowerOrEqualThanPrepare.reduce((acc, b) => {
        //             if (isBallotLower(acc, b)) acc = b;
        //             return acc;
        //         })
        //     state.prepare.prepared = highestAcceptedPreparedBallotNotExceedingBallotField!;
        //     if (state.prepare.ballot.value.length < state.prepare.prepared.value.length && state.prepare.ballot.counter === state.prepare.prepared.counter) {
        //         state.prepare.prepared.counter = state.prepare.ballot.counter - 1;
        //         // Note:  it is not possible to vote to commit a ballot with counter 0.
        //     }
        // }
    }

    const recalculateACounter = (oldPrepared: ScpBallot | null) => {
        if (!oldPrepared) return;
        if (hashBallotValue(oldPrepared) !== hashBallotValue(state.prepare.prepared)) {
            if (oldPrepared.value.length < state.prepare.prepared!.value.length) {
                state.prepare.aCounter = oldPrepared.counter;
            }
            else {
                state.prepare.aCounter = oldPrepared.counter + 1;
            }
        }
    }

    const recalculateHCounter = () => {
        const highestConfirmed = state.getHighestConfirmedPreparedBallot();
        if (highestConfirmed && hashBallotValue(highestConfirmed) === hashBallotValue(state.prepare.ballot)) {
            state.prepare.hCounter = highestConfirmed.counter;
        }
        else {
            state.prepare.hCounter = 0;
        }
    }

    const updateCommitBallot = () => {
        if ((state.commitBallot && isBallotLower(state.commitBallot, state.prepare.prepared!) && hashBallotValue(state.prepare.prepared) !== hashBallotValue(state.commitBallot))
            || state.prepare.aCounter > state.prepare.cCounter) {
            log('reset commit ballot')
            state.commitBallot = null;
        }
        if (state.commitBallot === null && state.prepare.hCounter === state.prepare.ballot.counter) {
            state.commitBallot = _.cloneDeep(state.prepare.ballot);
            log('set commit ballot to ', state.commitBallot)
        }
    }

    const recalculateCCounter = () => {
        updateCommitBallot();
        if (state.commitBallot === null || state.prepare.hCounter === 0) { state.prepare.cCounter = 0; }
        else { state.prepare.cCounter = state.commitBallot.counter; }
    }

    const onBallotCounterChange = () => {
        recalculatePrepareBallotValue();
    }

    const sendPrepareMessage = () => {
        const msg: ScpPrepareEnvelope = {
            message: state.prepare,
            sender: state.options.self,
            type: "ScpPrepare" as 'ScpPrepare',
            slices: state.options.slices,
            timestamp: Date.now(),
        }
        broadcast(msg);
    }

    const checkEnterCommitPhase = () => {
        // FIXME: A node leaves the PREPARE phase and proceeds to the COMMIT phase when
        // there is some ballot "b" for which the node confirms "prepare(b)" and
        // accepts "commit(b)"
        if (state.confirmedPrepared.length > 0 && state.acceptedCommitted.length > 0) {
            enterCommitPhase();
        }
    }

    const enterPreparePhase = () => {
        state.phase = 'PREPARE'
        log('Entering Prepare Phase')
        state.prepare.ballot.value = _.clone(state.confirmedValues);
        sendPrepareMessage();
    }

    // TODO: Include Counter limit logic
    // FIXME: execute this stuff when receiving message
    const receivePrepare = (envelope: ScpPrepareEnvelope) => {
        state.prepareStorage.set(envelope.sender, envelope.message, envelope.timestamp);
        state.lastReceivedPrepareEnvelope = _.cloneDeep(envelope);
        checkPrepareBallotAcceptQuorum(state.prepare.ballot);
        checkPrepareBallotAcceptBlockingSet(state.prepare.ballot);
        if (state.lastReceivedPrepareEnvelope) {
            checkPrepareBallotAcceptBlockingSet(state.lastReceivedPrepareEnvelope.message.ballot);
        }
        // checkPrepareBallotAccept(envelope.message.ballot);
        if (state.prepare.prepared) {
            checkPrepareBallotConfirm(state.prepare.prepared);
        }
        checkPrepareBallotAcceptCommit();
    }

    const doPrepareUpdate = () => {
        const currentCounter = state.prepare.ballot.counter;
        checkQuorumForCounter(state, () => state.prepare.ballot.counter = state.prepare.ballot.counter + 1, () => {
            onBallotCounterChange();
            doPrepareUpdate();
        });
        checkBlockingSetForCounterPrepare(state, (value: number) => state.prepare.ballot.counter = _.cloneDeep(value));
        if (state.prepare.ballot.counter !== currentCounter) {
            log(`Counter changed from ${currentCounter} to ${state.prepare.ballot.counter}`)
            onBallotCounterChange();
            doPrepareUpdate();
        }
        const oldPrepared = _.cloneDeep(state.prepare.prepared);
        recalculatePreparedField();
        if (hashBallotValue(oldPrepared) !== hashBallotValue(state.prepare.prepared)) {
            recalculateACounter(oldPrepared);
        }
        recalculateHCounter();
        recalculateCCounter();
        sendPrepareMessage();
        checkEnterCommitPhase();
    }

    return {
        receivePrepare,
        enterPreparePhase,
        doPrepareUpdate
    }
}