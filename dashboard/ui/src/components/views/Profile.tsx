/*
    This component is used to display or create a new profile from the Weight table.

*/

import React, { useState, useEffect, useMemo } from 'react';
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
    Field,
    useListCollection,
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

    const handleProfileChange = (details: { value: string[] }) => {
        setSelectedProfile(details.value[0] || '');
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

    const handleScoreProfileChange = (details: { value: string[] }) => {
        setScoreProfile(details.value[0] || '');
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

    // Collections for Select components
    const profileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const profileCollection = useListCollection({ initialItems: profileItems });

    const scoreProfileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const scoreProfileCollection = useListCollection({ initialItems: scoreProfileItems });

    const sourceProfileItems = useMemo(() =>
        profiles
            .filter((profile: string) => profile != null && profile !== '')
            .map((profile: string) => ({ label: profile, value: profile })),
        [profiles]
    );
    const sourceProfileCollection = useListCollection({ initialItems: sourceProfileItems });

    return (
        <Box p={4} bg="var(--color-bg-page)">
            <VStack align="stretch" gap={6}>
                <Heading color="var(--color-text)">Profile Management</Heading>

                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color="var(--color-text)">Profile Selection</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color="var(--color-text)">Score Profile</Field.Label>
                                <Select.Root
                                    collection={scoreProfileCollection.collection}
                                    value={scoreProfile ? [scoreProfile] : []}
                                    onValueChange={handleScoreProfileChange}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg="var(--color-bg-card)" borderColor="var(--color-border)" color="var(--color-text)">
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select score profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {scoreProfileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>
                            <Button
                                onClick={handleSetScoreProfile}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                alignSelf="flex-end"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                            >
                                Set Score Profile
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color="var(--color-text)">Copy Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color="var(--color-text)">Source Profile</Field.Label>
                                <Select.Root
                                    collection={sourceProfileCollection.collection}
                                    value={sourceProfile ? [sourceProfile] : []}
                                    onValueChange={(details) => setSourceProfile(details.value[0] || '')}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg="var(--color-bg-card)" borderColor="var(--color-border)" color="var(--color-text)">
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select source profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {sourceProfileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>
                            <Field.Root>
                                <Field.Label color="var(--color-text)">New Profile Name</Field.Label>
                                <Input
                                    value={newProfileName}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewProfileName(e.target.value)}
                                    bg="var(--color-bg-card)"
                                    borderColor="var(--color-border)"
                                    color="var(--color-text)"
                                    _focus={{ borderColor: 'var(--color-primary)' }}
                                />
                            </Field.Root>
                            <Button
                                onClick={handleCopyProfile}
                                disabled={!sourceProfile || !newProfileName}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                alignSelf="flex-end"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                {isCopying ? 'Copying...' : 'Copy Profile'}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>

                <Box borderWidth={1} borderRadius="md" p={4} bg="var(--color-bg-card)" borderColor="var(--color-border)">
                    <VStack align="stretch" gap={4}>
                        <Heading size="md" color="var(--color-text)">Update Profile</Heading>
                        <HStack gap={4}>
                            <Field.Root>
                                <Field.Label color="var(--color-text)">Profile</Field.Label>
                                <Select.Root
                                    collection={profileCollection.collection}
                                    value={selectedProfile ? [selectedProfile] : []}
                                    onValueChange={handleProfileChange}
                                >
                                    <Select.HiddenSelect />
                                    <Select.Control bg="var(--color-bg-card)" borderColor="var(--color-border)" color="var(--color-text)">
                                        <Select.Trigger>
                                            <Select.ValueText placeholder="Select profile" />
                                        </Select.Trigger>
                                        <Select.IndicatorGroup>
                                            <Select.Indicator />
                                        </Select.IndicatorGroup>
                                    </Select.Control>
                                    <Select.Positioner>
                                        <Select.Content>
                                            {profileItems.map((item) => (
                                                <Select.Item key={item.value} item={item}>
                                                    <Select.ItemText>{item.label}</Select.ItemText>
                                                </Select.Item>
                                            ))}
                                        </Select.Content>
                                    </Select.Positioner>
                                </Select.Root>
                            </Field.Root>

                            <Button
                                onClick={handleSave}
                                bg="var(--color-primary)"
                                color="var(--color-primary-text)"
                                alignSelf="flex-end"
                                _hover={{ bg: 'var(--color-primary-hover)' }}
                                _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </HStack>

                        <Table.Root>
                            <Table.Header bg="var(--color-bg-header)">
                                <Table.Row>
                                    <Table.ColumnHeader color="var(--color-text)">Pack</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Weight</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Order</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Enabled</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Group 1</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Group 2</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Group 3</Table.ColumnHeader>
                                    <Table.ColumnHeader color="var(--color-text)">Group 4</Table.ColumnHeader>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {weights.map((weight) => (
                                    <Table.Row
                                        key={weight._id}
                                        _hover={{ bg: 'var(--color-bg-hover)' }}
                                        borderColor="var(--color-border)"
                                    >
                                        <Table.Cell color="var(--color-text)">{weight.pack}</Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.weight}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'weight', parseInt(e.target.value))}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                type="number"
                                                value={weight.priority}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'priority', parseInt(e.target.value))}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Switch.Root
                                                checked={weight.enabled}
                                                onCheckedChange={(details) => handleWeightChange(weight._id, 'enabled', details.checked)}
                                            >
                                                <Switch.HiddenInput />
                                                <Switch.Control>
                                                    <Switch.Thumb />
                                                </Switch.Control>
                                            </Switch.Root>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group1 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group1', e.target.value)}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group2 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group2', e.target.value)}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group3 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group3', e.target.value)}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
                                            />
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Input
                                                value={weight.group4 || ''}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleWeightChange(weight._id, 'group4', e.target.value)}
                                                size="sm"
                                                bg="var(--color-bg-card)"
                                                borderColor="var(--color-border)"
                                                color="var(--color-text)"
                                                _focus={{ borderColor: 'var(--color-primary)' }}
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