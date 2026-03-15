const { isUserOfType, getUserFromToken } = require('./authService');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Resolves to true when the token belongs to a Mission Creator, false otherwise.
 * Wraps the callback-based isUserOfType so callers can simply await it.
 */
const checkIsAdmin = async (authToken) => {
    return isUserOfType(getUserFromToken(authToken), ['Mission Creator']);
};

// ---------------------------------------------------------------------------
// YAML builders
// ---------------------------------------------------------------------------

const buildNetworkPolicyYAML = (device, ingressRules, egressRules) => {
    const networkPolicyId = `policy-${device}`;

    const ingressSection = ingressRules && ingressRules.length > 0
        ? `  ingress:\n${ingressRules.map(r =>
            `  - from:\n    - podSelector:\n        matchLabels:\n          app: ${r.device}\n    ports:\n    - protocol: ${r.protocol}\n      port: ${r.port}`
        ).join('\n')}`
        : '';

    const egressSection = egressRules && egressRules.length > 0
        ? `  egress:\n${egressRules.map(r =>
            `  - to:\n    - podSelector:\n        matchLabels:\n          app: ${r.device}\n    ports:\n    - protocol: ${r.protocol}\n      port: ${r.port}`
        ).join('\n')}`
        : '';

    const yaml = [
        'apiVersion: networking.k8s.io/v1',
        'kind: NetworkPolicy',
        'metadata:',
        `  name: ${networkPolicyId}`,
        'spec:',
        '  podSelector:',
        '    matchLabels:',
        `      app: ${device}`,
        '  policyTypes:',
        '  - Ingress',
        '  - Egress',
        ingressSection,
        egressSection,
    ].filter(Boolean).join('\n');

    return { networkPolicyId, yaml };
};

const parseNetworkPolicies = (stdout) => {
    const parsedOutput = JSON.parse(stdout);
    return parsedOutput.items.map(policy => ({
        name: policy.metadata.name,
        podSelector: policy.spec.podSelector,
        policyTypes: policy.spec.policyTypes,
        ingress: policy.spec.ingress,
        egress: policy.spec.egress,
    }));
};

// ---------------------------------------------------------------------------
// addNetworkPolicy
// ---------------------------------------------------------------------------
exports.addNetworkPolicy = async (req, res) => {
    const { authToken, device, ingress, egress } = req.body;

    try {
        // BUG FIX: original code called isAdmin() without await, so the 403
        // branch was unreachable. Now correctly awaited.
        const admin = await checkIsAdmin(authToken);

        if (!admin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        const { networkPolicyId, yaml } = buildNetworkPolicyYAML(device, ingress, egress);

        exec(`kubectl apply -f - <<EOF\n${yaml}\nEOF`, (error) => {
            if (error) {
                console.error(`Error executing kubectl: ${error}`);
                return res.status(500).json({ message: 'Failed to create NetworkPolicy' });
            }
            return res.status(200).json({ networkPolicyId });
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// addNetworkPolicyDuringMission  (called internally — no auth check needed)
// ---------------------------------------------------------------------------
const addNetworkPolicyDuringMission = async (device, ingress, egress) => {
    const { networkPolicyId, yaml } = buildNetworkPolicyYAML(device, ingress, egress);

    try {
        await execAsync(`kubectl apply -f - <<EOF\n${yaml}\nEOF`);
        console.log(`NetworkPolicy created successfully with ID: ${networkPolicyId}`);
        return networkPolicyId;
    } catch (error) {
        console.error(`Error executing kubectl: ${error}`);
        throw new Error('Failed to create NetworkPolicy');
    }
};

exports.addNetworkPolicyDuringMission = addNetworkPolicyDuringMission;

// ---------------------------------------------------------------------------
// getNetworkPolicies
// ---------------------------------------------------------------------------
exports.getNetworkPolicies = async (req, res) => {
    const { authToken } = req.query;

    try {
        const admin = await checkIsAdmin(authToken);

        if (!admin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        exec('kubectl get networkpolicies --namespace=default -o json', (error, stdout) => {
            if (error) {
                console.error(`Error executing kubectl: ${error}`);
                return res.status(500).json({ message: 'Failed to fetch NetworkPolicies' });
            }

            try {
                return res.status(200).json(parseNetworkPolicies(stdout));
            } catch (parseError) {
                console.error(`Error parsing NetworkPolicy JSON: ${parseError}`);
                return res.status(500).json({ message: 'Failed to parse NetworkPolicies' });
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// deleteNetworkPolicy
// ---------------------------------------------------------------------------
exports.deleteNetworkPolicy = async (req, res) => {
    const { authToken, policyName } = req.body;

    try {
        const admin = await checkIsAdmin(authToken);

        if (!admin) {
            return res.status(403).json({ message: 'Unauthorized: Only admin users can perform this action' });
        }

        exec(`kubectl delete networkpolicy ${policyName} --namespace=default`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing kubectl: ${error}`);
                return res.status(500).json({ message: 'Failed to delete NetworkPolicy' });
            }
            if (stderr) {
                console.error(`Error deleting NetworkPolicy: ${stderr}`);
                return res.status(500).json({ message: 'Failed to delete NetworkPolicy' });
            }
            return res.status(200).json({ message: 'NetworkPolicy deleted successfully' });
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// deleteNetworkPolicyDuringMission  (fire-and-forget, called from missionService)
// ---------------------------------------------------------------------------
const deleteNetworkPolicyDuringMission = (policyName) => {
    exec(`kubectl delete networkpolicy ${policyName} --namespace=default`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error deleting NetworkPolicy: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Error deleting NetworkPolicy: ${stderr}`);
            return;
        }
        console.log('NetworkPolicy deleted successfully');
    });
};

exports.deleteNetworkPolicyDuringMission = deleteNetworkPolicyDuringMission;