const { EC2Client, RunInstancesCommand, TerminateInstancesCommand, WaiterState, waitForInstanceRunning } = require('@aws-sdk/client-ec2');
const core = require('@actions/core');
const config = require('./config');

const ec2 = new EC2Client({ region: "us-east-1" }); // Set your AWS region

function buildUserDataScript(githubRegistrationToken, label) {
    const runnerUser = config.input.runnerUser || "root"; // Default to 'root' if not provided

    // Helper function to prepend sudo for non-root users
    const runAsUser = (command) => {
        return runnerUser === "root" ? command : `sudo -u ${runnerUser} ${command} -u ${runnerUser}`;
    };

    const baseCommands = [
        '#!/bin/bash',
        'mkdir actions-runner && cd actions-runner',
        'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
        'curl -O -L https://github.com/actions/runner/releases/download/v2.305.0/actions-runner-linux-${RUNNER_ARCH}-2.305.0.tar.gz',
        'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.305.0.tar.gz',
        `chown -R ${runnerUser}:${runnerUser} .`,
        'export RUNNER_ALLOW_RUNASROOT=1',
        runAsUser(`./config.sh --url https://github.com/${config.githubContext.owner} --token ${githubRegistrationToken} --labels ${label} --runnergroup aws_runners --unattended`),
        runAsUser('./run.sh'),
    ];

    if (config.input.runnerHomeDir) {
        return [
            '#!/bin/bash',
            `cd "${config.input.runnerHomeDir}"`,
            'export RUNNER_ALLOW_RUNASROOT=1',
            runAsUser(`./config.sh --url https://github.com/${config.githubContext.owner} --token ${githubRegistrationToken} --labels ${label} --runnergroup aws_runners --unattended`),
            runAsUser('./run.sh'),
        ];
    } else {
        return baseCommands;
    }
}

async function startEc2Instance(label, githubRegistrationToken) {
    const userData = buildUserDataScript(githubRegistrationToken, label);

    const params = {
        ImageId: config.input.ec2ImageId,
        InstanceType: config.input.ec2InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: Buffer.from(userData.join('\n')).toString('base64'),
        SubnetId: config.input.subnetId,
        SecurityGroupIds: [config.input.securityGroupId],
        IamInstanceProfile: { Name: config.input.iamRoleName },
        TagSpecifications: config.tagSpecifications,
    };

    try {
        const command = new RunInstancesCommand(params);
        const result = await ec2.send(command);
        const ec2InstanceId = result.Instances[0].InstanceId;
        core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
        return ec2InstanceId;
    } catch (error) {
        core.error('AWS EC2 instance starting error');
        throw error;
    }
}

async function terminateEc2Instance() {
    const params = {
        InstanceIds: [config.input.ec2InstanceId],
    };

    try {
        const command = new TerminateInstancesCommand(params);
        await ec2.send(command);
        core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    } catch (error) {
        core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
        throw error;
    }
}

async function customWaitForInstanceRunning(ec2InstanceId) {
  const params = {
      InstanceIds: [ec2InstanceId],
  };

  try {
      await waitForInstanceRunning(ec2, params); // Using the imported function
      core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
  } catch (error) {
      core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
      throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  customWaitForInstanceRunning,
};