/*
    This component is used to display or create a new profile from the Weight table.

*/

import React, { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
    Box,
    Button,
    VStack,
    HStack,
    Heading,
    Select,
    Input,
    Table,
    Switch,
} from '@chakra-ui/react';
import { toaster } from '../ui/toaster';
import type { Weight } from '../../services/types';
import { getProfileList, getProfileDetails, saveProfile, copyProfile } from '../../services/api';
import Cookies from 'js-cookie';

export const Profile: React.FC = () => {
    usePageTitle('Profiles');

    const [profiles, setProfiles] = useState<string[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<string>('');
    const [scoreProfile, setScoreProfile] = useState<string>('');
    const [weights, setWeights] = useState<Weight[]>([]);
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [sourceProfile, setSourceProfile] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isCopying, setIsCopying] = useState(false);

    // Fetch available profiles
    useEffect(() => {
        const fetchProfiles = async () => {
            try {
                const data = await getProfileList();
                setProfiles(data);
                if (data.length > 0) {
                    // Set initial score profile from cookie or default to first profile
                    const savedScoreProfile = Cookies.get('scoreProfile');
                    const initialProfile = savedScoreProfile || data[0];
                    setScoreProfile(initialProfile);
                    setSelectedProfile(initialProfile);
                    setSourceProfile(data[0]);
                }
            } catch (error) {
                console.error('Error fetching profiles:', error);
                toaster.create({
                    title: 'Error fetching profiles',
                    description: error instanceof Error ? error.message : 'Unknown error',
                    type: 'error',
                    duration: 5000,
                });
            }
        };
        fetchProfiles();
    }, []);

    // Fetch weights for selected profile
    useEffect(() => {
        const fetchWeights = async () => {
            if (selectedProfile) {
                try {
                    const data = await getProfileDetails(selectedProfile);
                    setWeights(data);
                } catch (error) {
                    toaster.create({
                        title: 'Error fetching weights',
                        description: error instanceof Error ? error.message : 'Unknown error',
                        type: 'error',
                        duration: 5000,
                    });
                }
            }
        };
        fetchWeights();
    }, [selectedProfile]);

    const handleProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedProfile(event.target.value);
    };

    const handleWeightChange = (id: number, field: keyof Weight, value: any) => {
        setWeights(weights.map(weight =>
            weight._id === id ? { ...weight, [field]: value } : weight
        ));
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            await saveProfile(selectedProfile, weights);
            // Refresh the weights after saving
            const data = await getProfileDetails(selectedProfile);
            setWeights(data);
            toaster.create({
                title: 'Success',
                description: 'Profile saved successfully',
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Error saving profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyProfile = async () => {
        if (!sourceProfile || !newProfileName) return;

        try {
            setIsCopying(true);
            await copyProfile({
                sourceProfile,
                newProfile: newProfileName,
            });

            // Refresh profiles list
            const data = await getProfileList();
            setProfiles(data);

            // Clear form
            setSourceProfile('');
            setNewProfileName('');

            // Select the new profile
            setSelectedProfile(newProfileName);

            toaster.create({
                title: 'Success',
                description: 'Profile copied successfully',
                type: 'success',
                duration: 3000,
            });
        } catch (error) {
            toaster.create({
                title: 'Error copying profile',
                description: error instanceof Error ? error.message : 'Unknown error',
                type: 'error',
                duration: 5000,
            });
        } finally {
            setIsCopying(false);
        }
    };

    const handleScoreProfileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setScoreProfile(event.target.value);
    };

    const handleSetScoreProfile = () => {
        Cookies.set('scoreProfile', scoreProfile, { expires: 365 }); // Cookie expires in 1 year
        toaster.create({
            title: 'Success',
            description: `Score computation profile set to ${scoreProfile}`,
            type: 'success',
            duration: 3000,
        });
    };

    return (
        <Box p={4}>
            <VStack align="stretch" gap={6}>
                <Heading>Profile Management</Heading>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md">Profile Selection</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Select
                                    value={scoreProfile}
                                    onChange={handleScoreProfileChange}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </Field.Root>
                            <Button
                                onClick={handleSetScoreProfile}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                Set Score Profile
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md">Copy Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label>Source Profile</Field.Label>
                                <Select
                                    value={sourceProfile}
                                    onChange={(e) => setSourceProfile(e.target.value)}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>New Profile Name</Field.Label>
                                <Input
                                    value={newProfileName}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewProfileName(e.target.value)}
                                />
                            </Field.Root>
                            <Button
                                onClick={handleCopyProfile}
                                loading={isCopying}
                                disabled={!sourceProfile || !newProfileName}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                {isCopying ? 'Copying...' : 'Copy Profile'}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4}>
                    <VStack align="stretch" gap={4}>
                        <Heading size="md">Update Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Select
                                    value={selectedProfile}
                                    onChange={handleProfileChange}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile} value={profile}>
                                            {profile}
                                        </option>
                                    ))}
                                </Select>
                            </Field.Root>

                            <Button
                                onClick={handleSave}
                                loading={isSaving}
                                colorScheme="blue"
                                alignSelf="flex-end"
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </HStack>

                        <Table.Root variant="simple">
                            <Table.Header>
                                <Table.Row>
                                    <Table.ColumnHeader>Pack</Table.ColumnHeader>
                                    <Table.ColumnHeader>Weight</Table.ColumnHeader>
                                    <Table.ColumnHeader>Order</Table.ColumnHeader>
                                    <Table.ColumnHeader>Enabled</Table.ColumnHeader>
                                    <Table.ColumnHeader>Group 1</Table.ColumnHeader>
                                    <Table.ColumnHeader>Group 2</Table.ColumnHeader>
                                    <Table.ColumnHeader>Group 3</Table.ColumnHeader>
                                    <Table.ColumnHeader>Group 4</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {weights.map((weight) => (
                                    <Table.Row key={weight._id}>
                                        <Table.Cell>{weight.pack}</Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.weight}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'weight', parseInt(e.target.value))}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.priority}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'priority', parseInt(e.target.value))}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Switch
                                                isChecked={weight.enabled}
                                                onChange={(e) => handleWeightChange(weight._id, 'enabled', e.target.checked)}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group1 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group1', e.target.value)}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group2 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group2', e.target.value)}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group3 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group3', e.target.value)}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group4 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group4', e.target.value)}
                                                size="sm"
                                            />
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    </VStack>
                </Box>
            </VStack>
        </Box>
    );
};