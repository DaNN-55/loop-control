# C11 QC authority: strict, read-only review

## Conclusion

C11 can use a normal authenticated **test Owner** UI/API action after an Agent has inspected the isolated sample's local frames/video, provided the evidence says exactly that: “Agent inspected the local frames/video; Owner authorized the test-identity API action.” C11 requires each review to be explicitly operated by the test Owner through the normal UI/API; it does not require a biological Owner to have physically watched the QC video. No project contract examined adds that requirement.

This is not evidence of human viewing. It must not be described as “Owner watched,” “human confirmed,” or equivalent, and it does not satisfy any later requirement that expressly asks for a human media review. The generated package remains local; C11 does not authorize external publication.

## Basis and boundary

- C11 acceptance criterion 2 says: “各审核由测试 Owner 经正常界面/API 明确操作” (`.scratch/ad-closeout-20261025/published-bodies/C11.md:12`). It specifies authenticated authority and normal entrypoint, not a physical-viewing predicate.
- The domain contract defines approval as an Owner-written state transition with conclusion and reason, and bars a production Worker from approving its own output (`CONTEXT.md:137-140`). The QC transition implementation correspondingly checks Owner membership, a nonempty reason, current artifacts, and open blocking issues; it has no media-viewing attestation check (`db/local/c-baseline.sql:12126-12141`). `AGENTS.md` contains no stricter QC-viewing rule.
- The private harness's `assertHumanReceipt(..., 'qc-video-review')` requires `confirmedBy: 'human-owner'` and an actual user message, then writes “Owner 已观看…”. That is an extra harness assertion, not a C11 or project-contract rule (`/tmp/ad-closeout-141142-live/common.mjs:13`; `pipeline.mjs:55-56`). It cannot be satisfied by an Agent inspection or bypassed by fabricating a receipt.

## Required truthful evidence if proceeding

Record the inspected video/frame hashes and result; the authenticated test-Owner identity, normal API/UI request and response, review-package/episode linkage, and a reason that names the Agent inspection plus Owner authorization. Do not use the current hard-coded human-viewing receipt/reason. If a human-viewing claim is desired, wait for the real Owner QC action instead.
